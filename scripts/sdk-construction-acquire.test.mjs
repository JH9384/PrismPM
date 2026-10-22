import assert from 'node:assert/strict';
import test,{mock} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {syncBuiltinESMExports} from 'node:module';
import {constructionSelection,constructionSelectionJson,acquireConstruction} from './sdk-construction-acquire.mjs';
const source='a'.repeat(40),qualifier='b'.repeat(40);
const expected={revision:source,run_id:123,run_attempt:1,artifact_ids:{amd64:12,arm64:13}};
test('artifact source and executing qualifier source remain independently selected',()=>{
 assert.deepEqual(constructionSelection([source,'123','1','12','13',qualifier]),{expected,qualifier});
 assert.deepEqual(constructionSelectionJson(JSON.stringify(expected),qualifier),{expected,qualifier});
});
async function failureLifecycle(mode){
 const temp=fs.mkdtempSync(os.tmpdir()+'/construction-acquire-'),out=temp+'/evidence';
 fs.writeFileSync(temp+'/standards.lock','unit-only source bytes');fs.writeFileSync(temp+'/workflow.yml','unit-only workflow bytes');
 const originalWrite=fs.writeFileSync,originalRead=fs.readFileSync;let response,closed=false;
 mock.method(https,'request',(_url,_options,callback)=>{
  const request=new EventEmitter();request.setTimeout=()=>{};
  const close=()=>{if(!closed){closed=true;request.emit('close');}};
  request.destroy=error=>{if(error)request.emit('error',error);if(response)response.destroy(error);else queueMicrotask(close);return request;};
  request.end=()=>queueMicrotask(()=>{
   if(mode==='transport'){request.destroy(Error('unit-only transport interruption'));return;}
   response=Readable.from([Buffer.from('{invalid original authority')]);response.statusCode=200;response.headers={};response.complete=true;
   response.on('close',close);callback(response);
  });return request;
 });
 if(mode==='retention')mock.method(fs,'writeFileSync',function(path,...rest){if(String(path).endsWith('/provider-01.json'))throw Error('unit-only retention failure');return originalWrite.call(this,path,...rest);});
 if(mode==='resource')mock.method(fs,'readFileSync',function(path,...rest){if(String(path).startsWith('/sys/fs/cgroup/'))throw Error('unit-only resource observation failure');return originalRead.call(this,path,...rest);});
 syncBuiltinESMExports();
 try{
  await assert.rejects(acquireConstruction({expected,qualifier},temp+'/standards.lock',temp+'/workflow.yml',out,'unit_only_not_a_real_credential'));
  assert(closed);assert(!fs.existsSync(out+'/completed.json'));
  const failed=JSON.parse(originalRead(out+'/failed.json'));
  assert.equal(failed.cleanup.active_requests,0);assert.equal(failed.cleanup.all_sockets_closed,true);
  assert.equal(fs.existsSync(out+'/provider-01.json'),!['retention','transport'].includes(mode));
  assert.equal(fs.existsSync(out+'/resource-terminal.json'),mode!=='resource');
  return failed;
 }finally{mock.restoreAll();syncBuiltinESMExports();fs.rmSync(temp,{recursive:true});}
}
test('provider interruption closes owned transport and records failure without completion',async()=>{
 await failureLifecycle('transport');
});
test('malformed original authority is retained but cannot become an authenticated receipt',async()=>{
 await failureLifecycle('authority');
});
test('raw evidence retention failure cannot be ignored or produce completion',async()=>{
 assert.match((await failureLifecycle('retention')).reason,/retention failure/);
});
test('resource observation failure is retained after provider cleanup and cannot complete',async()=>{
 assert.match((await failureLifecycle('resource')).reason,/resource observation failed/);
});
test('closed source selection rejects malformed names unsafe IDs zero duplicates and extra fields',()=>{
 for(const args of[[source,'0','1','12','13',qualifier],[source,'123','01','12','13',qualifier],[source,'123','1','12','12',qualifier],
  [source,'123','1','9007199254740992','13',qualifier],['main','123','1','12','13',qualifier],
  [source,'123','1','12','13',qualifier,'extra']])assert.throws(()=>constructionSelection(args));
 for(const value of[{...expected,extra:true},{...expected,run_id:'123'},{...expected,run_id:1.5},
  {...expected,artifact_ids:{...expected.artifact_ids,foreign:14}},{...expected,run_attempt:-1}])assert.throws(()=>constructionSelectionJson(JSON.stringify(value),qualifier));
 assert.throws(()=>constructionSelectionJson('x'.repeat(16385),qualifier));assert.throws(()=>constructionSelectionJson('null',qualifier));
});
