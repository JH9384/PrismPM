// Bounded, incremental CI diagnostics. Never compiler or acceptance authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,mkdirSync,mkdtempSync,openSync,opendirSync,readSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

// Nine subject/witness files, two members for each of 78 cases, 12 controls,
// twelve observation runs and 34 retirement runs, plus outcomes: 282 members.
// Preserve two reserved slots; all per-file/aggregate/index byte bounds stay fixed.
export const diagnosticLimits=Object.freeze({files:284,fileBytes:16*1024**2,totalBytes:32*1024**2,indexBytes:128*1024});
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const fields=['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'];
function sameFile(left,right){for(const key of fields)assert.equal(left[key],right[key],'diagnostic input changed');}
function directory(path){
 assert.equal(realpathSync(path),resolve(path),'diagnostic directory alias');
 const stat=lstatSync(path);assert(stat.isDirectory()&&!stat.isSymbolicLink());return stat;
}
function child(parent,name){
 directory(parent);const path=join(parent,name);
 try{mkdirSync(path,{mode:0o755});}catch(error){if(error.code!=='EEXIST')throw error;}
 directory(path);return path;
}
export function readDiagnosticFile(path,maximum=diagnosticLimits.fileBytes){
 assert(Number.isSafeInteger(maximum)&&maximum>=0&&maximum<=diagnosticLimits.fileBytes);
 assert.equal(realpathSync(path),resolve(path),'diagnostic input alias');
 const before=lstatSync(path,{bigint:true});assert(before.isFile()&&before.nlink===1n&&before.size<=BigInt(maximum));
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=fstatSync(fd,{bigint:true});sameFile(before,opened);
  const data=Buffer.alloc(Number(opened.size)+1);let size=0;
  while(size<data.length){const count=readSync(fd,data,size,data.length-size,null);if(!count)break;size+=count;}
  assert.equal(BigInt(size),opened.size,'diagnostic input grew or truncated');
  sameFile(opened,fstatSync(fd,{bigint:true}));sameFile(opened,lstatSync(path,{bigint:true}));
  assert.equal(realpathSync(path),resolve(path),'diagnostic input alias');
  return data.subarray(0,size);
 }finally{closeSync(fd);}
}
export class PortableDiagnosticBundle {
 constructor(root){
  const parent=child(child(root,'target'),'ci-diagnostics');
  this.path=mkdtempSync(join(parent,'portable-oracle-'));this.identity=directory(this.path);
  this.files=[];this.total=0;this.state='collecting';this.index();
 }
 owned(){
  const current=directory(this.path);for(const key of ['dev','ino','mode','uid','gid'])assert.equal(current[key],this.identity[key]);
 }
 index(){
  this.owned();
  if(this.indexHash)assert.equal(hash(readDiagnosticFile(join(this.path,'index.json'),diagnosticLimits.indexBytes)),this.indexHash,'diagnostic index changed');
  const value={schema:'prismpm/portable-oracle-diagnostic-bundle/1',scope:'diagnostics-only-not-acceptance',
   state:this.state,total_bytes:this.total,files:this.files.slice().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
  const data=Buffer.from(canonical(value)+'\n');assert(data.length<=diagnosticLimits.indexBytes);
  const temporary=join(this.path,'index.next');writeFileSync(temporary,data,{flag:'wx',mode:0o644});
  renameSync(temporary,join(this.path,'index.json'));
  this.indexHash=hash(data);
 }
 bytes(path,data){
  this.#bytes(path,data,false);
 }
 #bytes(path,data,final){
  this.owned();assert(this.state==='collecting'||(final&&this.state==='incomplete'&&path==='outcomes.json'));assert(Buffer.isBuffer(data));
  assert(path.length<=160&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)&&path.split('/').length<=4
   &&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
  assert(!this.files.some(row=>row.path===path),'diagnostic output cannot overwrite');
  assert(this.files.length<diagnosticLimits.files-2&&data.length<=diagnosticLimits.fileBytes
   &&this.total+data.length<=diagnosticLimits.totalBytes-2*diagnosticLimits.indexBytes,'diagnostic byte or file limit');
  let parent=this.path;const parts=path.split('/');for(const name of parts.slice(0,-1))parent=child(parent,name);
  writeFileSync(join(parent,parts.at(-1)),data,{flag:'wx',mode:0o644});
  this.files.push({path,byte_length:data.length,sha256:hash(data)});this.total+=data.length;this.index();
 }
 file(path,source,expected){
  assert.match(expected,/^[a-f0-9]{64}$/);const data=readDiagnosticFile(source);
  assert.equal(hash(data),expected,'diagnostic source differs from executed input');this.bytes(path,data);
 }
 json(path,value){this.bytes(path,Buffer.from(canonical(value)+'\n'));}
 finish(value,successful){
  this.#bytes('outcomes.json',Buffer.from(canonical(value)+'\n'),true);
  if(successful&&this.state==='collecting')this.complete();else this.incomplete();
 }
 complete(){
  assert.equal(this.state,'collecting');this.owned();
  const expected=new Set(['index.json']),observed=new Map();
  for(const row of this.files){
   const parts=row.path.split('/');for(let count=1;count<parts.length;count++)expected.add(parts.slice(0,count).join('/')+'/');
   expected.add(row.path);const selected=join(this.path,row.path),before=lstatSync(selected,{bigint:true});
   const data=readDiagnosticFile(selected);sameFile(before,lstatSync(selected,{bigint:true}));observed.set(selected,before);
   assert.equal(data.length,row.byte_length);assert.equal(hash(data),row.sha256,'diagnostic copy changed');
  }
  const actual=[];const visit=(path,prefix)=>{
   directory(path);const before=lstatSync(path,{bigint:true});observed.set(path,before);const iterator=opendirSync(path,{bufferSize:1});
   try{for(let entry;(entry=iterator.readSync())!==null;){
    assert(actual.length<diagnosticLimits.files*4+2);const selected=join(path,entry.name),stat=lstatSync(selected);
    assert(!stat.isSymbolicLink());const name=prefix+entry.name+(stat.isDirectory()?'/':'');
    assert(expected.has(name),'unexpected diagnostic output');actual.push(name);
    if(stat.isDirectory())visit(selected,name);else{
     assert(stat.isFile()&&stat.nlink===1);const current=lstatSync(selected,{bigint:true});
     if(observed.has(selected))sameFile(observed.get(selected),current);else observed.set(selected,current);
    }
   }}finally{iterator.closeSync();}
  };
  visit(this.path,'');assert.deepEqual(actual.sort(),[...expected].sort(),'diagnostic output inventory changed');
  for(const [path,before] of observed)sameFile(before,lstatSync(path,{bigint:true}));this.owned();
  this.state='completed';this.index();
 }
 incomplete(){this.state='incomplete';this.index();}
}

const integer=(value,maximum=65536)=>Number.isSafeInteger(value)&&value>=0&&value<=maximum?value:null;
const choice=(value,values)=>values.includes(value)?value:'other';
// Driver rows and previously closed summaries are separate, explicit input
// representations. Re-sanitizing a retained summary must preserve its facts;
// neither representation supplies acceptance or authority hashes.
export function submissionDiagnosticSummary(row,representation='driver'){
  assert(['driver','summary'].includes(representation));
  row=row&&typeof row==='object'?row:{};
  if(representation==='driver')assert(['prismpm/browser-submission-diagnostic/1','prismpm/browser-submission-diagnostic/2'].includes(row.schema));
  const network=representation==='driver'?row.schema==='prismpm/browser-submission-diagnostic/2':Object.hasOwn(row,'network');
  const field=(value,driver,summary)=>value?.[representation==='driver'?driver:summary];
  return{journey:choice(row.journey,['attachment-assets','modeled-vectors','input-validation-recovery','transport-failure-recovery',
    'pre-init-privacy','delayed-init','intent-boundaries','text-response-bounds','text-safe-rendering','detached-session']),
   phase:choice(row.phase,['initial-readiness','fill','submission','response-body','rendered-result','completed-readiness','completed']),
   failure:choice(row.failure,['assertion','timeout','unexpected','response-body-failed','response-body-unavailable']),
   check:choice(row.check,['response-status','request-envelope','request-navigation','response-json','response-envelope','single-invocation','main-frame-navigation',null]),
   vector_index:integer(field(row,'vectorIndex','vector_index')),invocation_count:integer(field(row,'invocationCount','invocation_count')),
   keyboard:typeof row.keyboard==='boolean'?row.keyboard:null,navigated:typeof row.navigated==='boolean'?row.navigated:null,
   ...(network?{events_truncated:typeof field(row,'eventsTruncated','events_truncated')==='boolean'?field(row,'eventsTruncated','events_truncated'):null,
    network:{state:choice(row.network?.state,['observed','unavailable']),
    requests:integer(row.network?.requests,32),overflow:typeof row.network?.overflow==='boolean'?row.network.overflow:null}}:{}),
   client:{state:choice(row.client?.state,['observed','closed','unavailable']),
    ...Object.fromEntries(['busy','disabled','expectedResult','outputPresent','responseError'].map(name=>
     [name,typeof row.client?.[name]==='boolean'?row.client[name]:null]))},
   events:(Array.isArray(row.events)?row.events:[]).slice(0,32).map(event=>{
    event=event&&typeof event==='object'?event:{};
    return{
    event:choice(event.event,['request','response','body','request-failed','request-finished','main-frame-navigation','page-crash','page-close',
     ...(network?['cdp-request','cdp-response','cdp-data','cdp-finished','cdp-failed']:[])]),
    method:choice(event.method,['GET','POST','OTHER']),invocation:typeof event.invocation==='boolean'?event.invocation:null,
    navigation:typeof event.navigation==='boolean'?event.navigation:null,service_worker:typeof field(event,'serviceWorker','service_worker')==='boolean'?field(event,'serviceWorker','service_worker'):null,
    reason:choice(event.reason,['ERR_ABORTED','ERR_FAILED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_CONTENT_LENGTH_MISMATCH',
     'ERR_INCOMPLETE_CHUNKED_ENCODING','ERR_INSUFFICIENT_RESOURCES','ERR_TIMED_OUT','ERR_BLOCKED_BY_CLIENT','ERR_BLOCKED_BY_RESPONSE','unavailable','other']),
    status:integer(event.status,599),bytes:integer(event.bytes,1048576),
    ...(network?{request:integer(event.request,32),encoded_bytes:integer(field(event,'encodedBytes','encoded_bytes'),16777216),
     payload_matches:typeof field(event,'payloadMatches','payload_matches')==='boolean'?field(event,'payloadMatches','payload_matches'):null,
     payload_oversized:typeof field(event,'payloadOversized','payload_oversized')==='boolean'?field(event,'payloadOversized','payload_oversized'):null,
     redirect:typeof event.redirect==='boolean'?event.redirect:null,disk_cache:typeof field(event,'diskCache','disk_cache')==='boolean'?field(event,'diskCache','disk_cache'):null,
     cancelled:typeof event.cancelled==='boolean'?event.cancelled:null}:{}),
   };})};
}
export function probeSummary(value){
 assert.equal(value.schema,'prismpm/portable-oracle-probe/1');
 const hashes={};for(const name of ['source','matrix','driver','oracle','model','archive','wasm','node','browser']){
  assert.match(value[name+'_sha256'],/^[a-f0-9]{64}$/);hashes[name+'_sha256']=value[name+'_sha256'];
 }
 assert(Array.isArray(value.diagnostics)&&value.diagnostics.length<=4);
 const diagnostics=value.diagnostics.map(row=>submissionDiagnosticSummary(row));
 return{hashes,exit_code:integer(value.exit_code,255),signal:choice(value.signal,[null,'SIGTERM','SIGKILL','SIGINT','SIGHUP']),
  probe_passed:value.probe_passed===true,product_acceptance:'not-established',diagnostics,
  ...(Object.hasOwn(value,'duplicate_control')?{
   duplicate_control_truncated:Array.isArray(value.duplicate_control)&&value.duplicate_control.length>1,
   duplicate_control:
   (Array.isArray(value.duplicate_control)?value.duplicate_control:[]).slice(0,1).map(row=>({
    state:choice(row?.state,['joined','missing']),pending:integer(row?.pending,32),
    outcomes_truncated:Array.isArray(row?.outcomes)&&row.outcomes.length>32,
    outcome_count:Array.isArray(row?.outcomes)?integer(row.outcomes.length):null,
    outcomes:(Array.isArray(row?.outcomes)?row.outcomes:[]).slice(0,32).map(outcome=>({
     status:choice(outcome?.status,['passed','failed','overflow']),http_status:integer(outcome?.http_status,599),
     bytes:integer(outcome?.bytes,16*1024**2),envelope:outcome?.envelope===true,
    })),
   }))}:{}),
 };
}

// A diagnostic failure must not invent acceptance, retry a case, or replace the
// original compiler/browser/process failure. Closed output contains no error text.
export function retainDiagnostic(bundle,collect,emit=value=>process.stderr.write(value)){
 if(!bundle||bundle.state!=='collecting')return false;
 try{collect();return true;}catch{
  try{bundle.incomplete();}catch{/* an unavailable destination is not acceptance */}
  try{emit('portable oracle diagnostic bundle incomplete\n');}catch{/* failed diagnostics cannot replace the original failure */}
  return false;
 }
}
