import assert from 'node:assert/strict';
import {readSemantic} from '../../scripts/semantic-source.mjs';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {prepare,run,draft,repository,sha} from '../../tests/browser-command/compile.mjs';
function corpus(){
 const source=readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1/WorkspaceCommandCorpus.lex.tex'),'utf8');
 const data=readSemantic(source);
 assert.equal(data.spec,'lexlean/semantic-module/2');
 const defs=new Map(data.declarations.map(d=>[d.name,d]));assert.equal(defs.size,data.declarations.length);
 const cache=new Map(),used=new Set();
 function expand(name,active=new Set()){
  assert.ok(!active.has(name)&&active.size<40);used.add(name);if(cache.has(name))return cache.get(name);
  const d=defs.get(name);assert.equal(d.kind,'definition');assert.deepEqual(d.parameters,[]);assert.deepEqual(d.result,{kind:'bytes'});
  const next=new Set([...active,name]);
  function bytes(x){
   if(x.kind==='bytes'){assert.ok(x.hex.length<=512);return Buffer.from(x.hex,'hex');}
   if(x.kind==='call'){assert.deepEqual(x.arguments,[]);assert.match(x.function.name,/^fixtureData[0-9]+$/);return expand(x.function.name,next);}
   assert.equal(x.kind,'primitive');assert.equal(x.operation,'append');assert.deepEqual(x.result,{kind:'bytes'});assert.equal(x.arguments.length,2);
   const result=Buffer.concat(x.arguments.map(bytes));assert.ok(result.length<=139874);return result;
  }
  const result=bytes(d.body);cache.set(name,result);return result;
 }
 const ids=[...defs.keys()].filter(n=>n.startsWith('request')).map(n=>n.slice(7));assert.equal(ids.length,75);
 const vectors=ids.map(id=>{
  const probe=defs.get('probe'+id);assert.deepEqual(probe.body,{arguments:[{arguments:[{arguments:[],function:{name:'request'+id},kind:'call'}],function:{module:'Foundation.Browser.V1.WorkspaceCommand',name:'workspaceCommandBytes'},kind:'call'},{arguments:[],function:{name:'response'+id},kind:'call'}],kind:'primitive',operation:'equal',result:{kind:'bool'}});
  used.add(probe.name);return {id,request:expand('request'+id),response:expand('response'+id)};
 });assert.deepEqual([...used].sort(),[...defs.keys()].sort());assert.equal(sha(vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join('')),'5882c793b79054fa47535a31beb99053049886c3ba8573436dd24e18389455d6','every original literal vector remains byte-exact');return vectors;
}
test('WC-01 complete modeled command corpus and all typed failures',()=>{
 const vectors=corpus();assert.equal(vectors.length,75);
 assert.deepEqual([...new Set(vectors.filter(v=>v.response.length===1).map(v=>v.response[0]))].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
 assert.equal(vectors.filter(v=>v.response[0]===0).length,24);
});
test('WC-02 fresh normal C/native/no_std/CoreWasm command semantics',{timeout:1200000},async t=>{
 const vectors=corpus(),build=prepare();t.after(()=>rmSync(build.work,{recursive:true,force:true}));
 t.diagnostic('work '+build.work+'; source '+build.verified.source_id+'; attestation '+build.verified.attestation_id+'; IR '+build.generation.ir_sha256);
 const path=join(build.work,'vectors.tsv');writeFileSync(path,vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''),{flag:'wx'});
 for(const standard of [true,false]){
  const binary=build.compileNative(standard),output=run(binary,[path],build.runner);
  assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(m=>m[1]),vectors.map(v=>v.id));
  assert.match(output,/PASS 75 complete generated command vectors twice/);t.diagnostic(output.trim());
  await t.test(standard?'generated native':'generated no_std',()=>{});
 }
 const module=new WebAssembly.Module(build.wasmBytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);let maximum=0,worst='';
 function invoke(input,id){
  const instance=new WebAssembly.Instance(module,{}),pointer=instance.exports.holo_alloc(input.length);new Uint8Array(instance.exports.memory.buffer,pointer,input.length).set(input);
  const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,input.length)),offset=Number(packed>>32n),length=Number(packed&0xffffffffn);
  assert.ok(length<=74243&&offset+length<=instance.exports.memory.buffer.byteLength);
  if(instance.exports.memory.buffer.byteLength>maximum){maximum=instance.exports.memory.buffer.byteLength;worst=id;}
  assert.ok(maximum<=64*65536);return Buffer.from(new Uint8Array(instance.exports.memory.buffer,offset,length));
 }
 for(const v of vectors)for(let repeat=0;repeat<2;repeat++){
  if(v.request.length>139873){assert.equal(v.id,'OverRequestAllocationCap');assert.throws(()=>invoke(v.request,v.id),WebAssembly.RuntimeError);}
  else assert.deepEqual(invoke(v.request,v.id),v.response,v.id);
 }
 await t.test('all 75 vectors twice through fresh bounded command guests',()=>{});
 t.diagnostic('maximum '+maximum+' bytes ('+maximum/65536+' pages), case '+worst+'; Wasm '+sha(build.wasmBytes));
 const {verifyBrowser}=await import('../../tests/browser-command/browser-test.mjs');const browser=await verifyBrowser(build,run,vectors);
 await t.test('WC-03 actual Chromium crypto and durable Journal replay with native transcripts',()=>{});t.diagnostic(JSON.stringify(browser));
 const {verifyAdapter,verifyAdapterMutants}=await import('../../tests/browser-command/adapter.mjs');
 let adapter;await t.test('actual status-only command journeys and native transcripts',async t=>{adapter=await verifyAdapter(build,run,vectors);t.diagnostic(JSON.stringify(adapter));});
 await t.test('all six command adapter planted defects',async t=>t.diagnostic(JSON.stringify(await verifyAdapterMutants(build,vectors))));
 const {verifyReentrantClose,verifyStorageErrors}=await import('../../tests/browser-api/lifecycle.mjs');
 await t.test('reentrant capture close and omission mutant',()=>verifyReentrantClose('Command',build));
 await t.test('hostile storage exception sanitization',()=>verifyStorageErrors('Command',build));
 const {verifyAccess}=await import('../../tests/browser-command/access.mjs');
 await t.test('outsider and revoked command callers never receive raw state',()=>verifyAccess(build));
 const {verifyDiagnostics}=await import('../../tests/browser-api/diagnostics.mjs');
 await t.test('registered Command defensive diagnostics',()=>verifyDiagnostics('Command',build,adapter.diagnostics));
});
