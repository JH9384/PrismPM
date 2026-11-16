import assert from 'node:assert/strict';
import {readSemantic} from '../../scripts/semantic-source.mjs';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {prepare,run,draft,repository,sha} from '../../tests/browser-query/compile.mjs';
export function corpus(){
 const source=readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1/WorkspaceQueryCorpus.lex.tex'),'utf8');
 const data=readSemantic(source);assert.equal(data.spec,'lexlean/semantic-module/2');
 const defs=new Map(data.declarations.map(d=>[d.name,d]));assert.equal(defs.size,data.declarations.length);
 const cache=new Map(),used=new Set();
 function expand(name,active=new Set()){
  assert.ok(!active.has(name)&&active.size<40);used.add(name);if(cache.has(name))return cache.get(name);
  const d=defs.get(name);assert.equal(d.kind,'definition');assert.deepEqual(d.parameters,[]);assert.deepEqual(d.result,{kind:'bytes'});const next=new Set([...active,name]);
  function bytes(x){
   if(x.kind==='bytes'){assert.ok(x.hex.length<=512);return Buffer.from(x.hex,'hex');}
   if(x.kind==='call'){assert.deepEqual(x.arguments,[]);assert.match(x.function.name,/^fixtureData[0-9]+$/);return expand(x.function.name,next);}
   assert.equal(x.kind,'primitive');assert.equal(x.operation,'append');assert.deepEqual(x.result,{kind:'bytes'});assert.equal(x.arguments.length,2);
   const result=Buffer.concat(x.arguments.map(bytes));assert.ok(result.length<=1166280);return result;
  }
  const result=bytes(d.body);cache.set(name,result);return result;
 }
 const ids=[...defs.keys()].filter(n=>n.startsWith('request')).map(n=>n.slice(7));assert.equal(ids.length,62);
 const vectors=ids.map(id=>{const probe=defs.get('probe'+id);assert.deepEqual(probe.body,{arguments:[{arguments:[{arguments:[],function:{name:'request'+id},kind:'call'}],function:{module:'Foundation.Browser.V1.WorkspaceQuery',name:'workspaceQueryBytes'},kind:'call'},{arguments:[],function:{name:'response'+id},kind:'call'}],kind:'primitive',operation:'equal',result:{kind:'bool'}});used.add(probe.name);return{id,request:expand('request'+id),response:expand('response'+id)};});
 const probe=defs.get('queryDecodeProbeBytes');assert.deepEqual(probe.parameters,[{name:'value',type:{kind:'bytes'}}]);assert.deepEqual(probe.result,{kind:'bytes'});assert.deepEqual(probe.body,{kind:'call',function:{module:'Foundation.Browser.V1.Workspace',name:'encodeU16'},arguments:[{kind:'call',function:{module:'Foundation.Browser.V1.WorkspaceQuery',name:'queryDecodeOctet'},arguments:[{kind:'record',type:{module:'Foundation.Browser.V1.Workspace',name:'WorkspaceByteView'},fields:[{field:'bytes',value:{kind:'var',name:'value'}}]}]}]});used.add('queryDecodeProbeBytes');
 assert.deepEqual([...used].sort(),[...defs.keys()].sort());assert.equal(sha(vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join('')),'6ab01a1bbcfe4a1d270addc11578dee78e30ade05d8b5f99f6183ed7ede27394','every original literal vector remains byte-exact');return vectors;
}
const exact=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label+' length');assert.ok(actual.equals(expected),label+' exact bytes');};
function rowBytes(response){const cursorLength=response.readUInt16BE(71),offset=73+cursorLength,length=response.readUIntBE(offset,3);assert.equal(response.length,offset+3+length);return response.subarray(offset+3);}
test('QY-01 complete literal corpus, all failures and complete original maxima',()=>{
 const vectors=corpus();assert.deepEqual([...new Set(vectors.filter(v=>v.response.length===1).map(v=>v.response[0]))].sort((a,b)=>a-b),Array.from({length:13},(_,i)=>i+1));
 for(const[table,total,width]of[['Members',64,33],['Messages',256,null]]){
  const pages=vectors.filter(v=>new RegExp('^Maximum'+table+'[0-9]+$').test(v.id));assert.equal(pages.length,total/16);
  const rows=[];for(let at=0;at<pages.length;at++){
   const response=pages[at].response;assert.equal(response[0],0);assert.equal(response.readUInt16BE(66),total);assert.equal(response.readUInt16BE(68),at*16);assert.equal(response[70],16);assert.equal(response.readUInt16BE(71),at+1===pages.length?0:135);rows.push(rowBytes(response));
  }
  const request=pages[0].request,headLength=request.readUIntBE(100,3),stateLength=request.readUIntBE(103,3),state=request.subarray(106+headLength,106+headLength+stateLength),memberLength=state.readUInt16BE(101),messageLength=state.readUIntBE(103,3);
  const expected=table==='Members'?Buffer.concat([state.subarray(33,65),Buffer.from([0]),state.subarray(108,108+memberLength)]):state.subarray(108+memberLength,108+memberLength+messageLength);
  exact(Buffer.concat(rows),expected,'complete '+table+' traversal');if(width)assert.equal(expected.length,total*width);
  assert.equal(state.length,1100427);assert.equal(headLength,65574);
 }
});
test('QY-03 fresh normal C/native/no_std/CoreWasm semantics',{timeout:1500000},async t=>{
 const vectors=corpus(),build=prepare();t.after(()=>rmSync(build.work,{recursive:true,force:true}));
 t.diagnostic('work '+build.work+'; source '+build.verified.source_id+'; attestation '+build.verified.attestation_id+'; IR '+build.generation.ir_sha256);
 const path=join(build.work,'vectors.tsv');writeFileSync(path,vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''),{flag:'wx'});
 const octets=Array.from({length:256},(_,i)=>({id:'Decode'+i,request:Buffer.from([i]),response:Buffer.from([0,i])}));octets.push({id:'DecodeEmpty',request:Buffer.alloc(0),response:Buffer.from([0,0])},{id:'DecodeLong',request:Buffer.from([1,2]),response:Buffer.from([0,0])});
 const octetPath=join(build.work,'octets.tsv');writeFileSync(octetPath,octets.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''),{flag:'wx'});
 for(const standard of[true,false]){const binary=build.compileNative(standard),output=run(binary,[path],build.runner);assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(m=>m[1]),vectors.map(v=>v.id));assert.match(output,/PASS 62 complete generated command vectors twice/);t.diagnostic(output.trim());const decoded=run(binary,[octetPath],build.runner);assert.match(decoded,/PASS 258 complete generated command vectors twice/);await t.test(standard?'generated native':'generated no_std',()=>{});}
 const module=new WebAssembly.Module(build.wasmBytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);let maximum=0,worst='';
 function invoke(input,id){const instance=new WebAssembly.Instance(module,{}),pointer=instance.exports.holo_alloc(input.length);new Uint8Array(instance.exports.memory.buffer,pointer,input.length).set(input);const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,input.length)),offset=Number(packed>>32n),length=Number(packed&0xffffffffn);assert.ok(length<=66803&&offset+length<=instance.exports.memory.buffer.byteLength);if(instance.exports.memory.buffer.byteLength>maximum){maximum=instance.exports.memory.buffer.byteLength;worst=id;}assert.ok(maximum<=512*65536);return Buffer.from(new Uint8Array(instance.exports.memory.buffer,offset,length));}
 for(const v of vectors)for(let repeat=0;repeat<2;repeat++){if(v.request.length>1166279){assert.equal(v.id,'OverAllocation');assert.throws(()=>invoke(v.request,v.id),WebAssembly.RuntimeError);}else exact(invoke(v.request,v.id),v.response,v.id);}
 await t.test('all62 vectors twice through fresh bounded512-page guests',()=>{});
 const probeModule=new WebAssembly.Module(build.probeWasm);assert.deepEqual(WebAssembly.Module.imports(probeModule),[]);
 for(const vector of octets)for(let repeat=0;repeat<2;repeat++){const instance=new WebAssembly.Instance(probeModule,{}),pointer=instance.exports.holo_alloc(vector.request.length);new Uint8Array(instance.exports.memory.buffer,pointer,vector.request.length).set(vector.request);const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,vector.request.length));exact(Buffer.from(new Uint8Array(instance.exports.memory.buffer,Number(packed>>32n),Number(packed&0xffffffffn))),vector.response,vector.id);assert.ok(instance.exports.memory.buffer.byteLength<=16*65536);}
 await t.test('exhaustive256octets plus closed empty/long probe through actual Wasm',()=>{});
 t.diagnostic('maximum '+maximum+' bytes ('+maximum/65536+' pages), case '+worst+'; Wasm '+sha(build.wasmBytes));
 const {prepare:prepareCommand}=await import('../../tests/browser-command/compile.mjs');
 const command=prepareCommand();t.after(()=>rmSync(command.work,{recursive:true,force:true}));command.compileNative(true);
 const {verifyBrowser}=await import('../../tests/browser-query/browser-test.mjs');
 let browser;await t.test('private admitted browser journeys, mutants and native transcripts',async t=>{browser=await verifyBrowser(build,command,vectors);t.diagnostic(JSON.stringify(browser));});
 const {verifyReentrantClose,verifyStorageErrors}=await import('../../tests/browser-api/lifecycle.mjs');
 await t.test('reentrant capture close and omission mutant',()=>verifyReentrantClose('Query',command,build));
 await t.test('hostile storage exception sanitization',()=>verifyStorageErrors('Query',command,build));
 const {verifyRuntime}=await import('../../tests/browser-query/runtime.mjs');
 await t.test('actual returned-cursor maximum traversal and hard limits',()=>verifyRuntime(build,vectors));
 const {verifyDiagnostics}=await import('../../tests/browser-api/diagnostics.mjs');
 const {verifyEntropy}=await import('../../tests/browser-query/entropy.mjs');
 await t.test('registered Query and inherited entropy diagnostics',async t=>{await verifyDiagnostics('Query',build,browser.diagnostics);t.diagnostic(JSON.stringify(await verifyEntropy(build)));});
});
