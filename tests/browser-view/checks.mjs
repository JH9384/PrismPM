import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare,run,sha,draft,repository} from './compile.mjs';
import {corpus,semanticCorpus} from './corpus.mjs';
import {source,literalLabels} from './label-model.mjs';
import {prepare as prepareCommand} from '../browser-command/compile.mjs';
import {prepare as prepareQuery} from '../browser-query/compile.mjs';
import {corpus as commandCorpus} from './command-corpus.mjs';
import {corpus as queryCorpus} from './query-corpus.mjs';
import {interoperability as queryInteroperability} from './query-interop.mjs';
import {prerequisite} from './prerequisites.mjs';

export function refuseBypasses(){
  for(const key of Object.keys(process.env))assert.ok(!key.startsWith('PRISMPM_VIEW_HOST_'),'diagnostic-only View bypass is not acceptance: '+key);
}
const tsv=vectors=>vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join('');
function wasm(bytes,vectors,inputCap,outputCap,pages){
  const module=new WebAssembly.Module(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);let maximum=0;
  for(const vector of vectors)for(let repeat=0;repeat<2;repeat++){
    const instance=new WebAssembly.Instance(module,{});
    if(vector.request.length>inputCap){assert.throws(()=>instance.exports.holo_alloc(vector.request.length),WebAssembly.RuntimeError);continue;}
    const pointer=instance.exports.holo_alloc(vector.request.length);new Uint8Array(instance.exports.memory.buffer,pointer,vector.request.length).set(vector.request);
    const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,vector.request.length)),at=Number(packed>>32n),length=Number(packed&0xffffffffn);
    assert.ok(length<=outputCap&&at+length<=instance.exports.memory.buffer.byteLength);
    assert.deepEqual(Buffer.from(new Uint8Array(instance.exports.memory.buffer,at,length)),vector.response,vector.id);
    maximum=Math.max(maximum,instance.exports.memory.buffer.byteLength);assert.ok(maximum<=pages*65536);
  }
  return maximum;
}
export async function verifyView(t,compilerOwner=null){
  refuseBypasses();
  const vectors=corpus();assert.equal(vectors.length,206);assert.equal(new Set(vectors.map(v=>v.id)).size,206);
  assert.equal(readFileSync(join(repository,'stdlib/src/Foundation/View/Workspace/V1/Corpus.lex.tex'),'utf8'),semanticCorpus());
  assert.equal(readFileSync(join(draft,'src/Foundation/View/Workspace/V1/Labels.lex.tex'),'utf8'),source());
  assert.deepEqual([...new Set(vectors.filter(v=>v.response.length===1).map(v=>v.response[0]))].sort((a,b)=>a-b),Array.from({length:14},(_,i)=>i+1));
  const build=prepare(null,compilerOwner);t.after(()=>rmSync(build.work,{recursive:true,force:true}));
  const path=join(build.work,'vectors.tsv');writeFileSync(path,tsv(vectors),{flag:'wx'});
  for(const standard of[true,false])await prerequisite(t,standard?'all 206 modeled View vectors twice in native Rust':'all 206 modeled View vectors twice in no_std Rust',()=>{
    const binary=build.compileNative(standard),output=run(binary,[path],build.runner);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(m=>m[1]),vectors.map(v=>v.id));
    assert.match(output,/PASS 206 complete generated View vectors twice/);assert.equal(run(binary,['--labels'],build.runner),literalLabels);
  });
  await prerequisite(t,'all 206 View vectors twice in fresh bounded Wasm',()=>{build.maximum=wasm(build.wasmBytes,vectors,133728,71055,128);});
  t.diagnostic(JSON.stringify({source:build.verified.source_id,attestation:build.verified.attestation_id,ir:build.generation.ir_sha256,wasm:sha(build.wasmBytes),labels:sha(literalLabels),maximum:build.maximum,compiler:build.compilerOwner,preparationMs:build.preparationMs}));
  return build;
}
export function verifyModelMutation(kind,compilerOwner=null){
  const vector=corpus().find(v=>v.id===(kind==='session'?'WrongSession':'PresentationMember'));assert.ok(vector);
  const build=prepare(kind,compilerOwner);
  try{
    const path=join(build.work,'mutation.tsv');writeFileSync(path,tsv([vector]),{flag:'wx'});
    const binary=build.compileNative(true);
    assert.throws(()=>run(binary,[path],build.runner),/native output|assertion|mismatch/,'actual generated mutant must fail its semantic assertion');
    return {mutation:kind,compiler:build.compilerOwner,source:build.verified.source_id,preparationMs:build.preparationMs};
  }finally{rmSync(build.work,{recursive:true,force:true});}
}
export async function verifyDependencies(t){
  const builds={};
  for(const[kind,prepare,corpus,count,inputCap,outputCap,pages]of[
    ['Command',prepareCommand,commandCorpus,75,139873,74243,64],['Query',prepareQuery,queryCorpus,62,1166279,66803,512]]){
    await prerequisite(t,'fresh complete '+kind+' source/kernel/C/native/no_std/Wasm dependency',()=>{
      const vectors=corpus();assert.equal(vectors.length,count);const build=prepare();t.after(()=>rmSync(build.work,{recursive:true,force:true}));
      const path=join(build.work,'view-dependency.tsv');writeFileSync(path,tsv(vectors),{flag:'wx'});
      const octets=kind==='Query'?Array.from({length:256},(_,i)=>({id:'Decode'+i,request:Buffer.from([i]),response:Buffer.from([0,i])})).concat([
        {id:'DecodeEmpty',request:Buffer.alloc(0),response:Buffer.from([0,0])},{id:'DecodeLong',request:Buffer.from([1,2]),response:Buffer.from([0,0])}]):[];
      const probes=join(build.work,'view-octets.tsv');if(octets.length)writeFileSync(probes,tsv(octets),{flag:'wx'});
      const interoperability=kind==='Query'?queryInteroperability():[];
      const interoperabilityPath=join(build.work,'view-query-grant-order.tsv');
      if(kind==='Query'){assert.equal(interoperability.length,4);writeFileSync(interoperabilityPath,tsv(interoperability),{flag:'wx'});}
      for(const standard of[true,false]){
        const binary=build.compileNative(standard),output=run(binary,[path],build.runner);
        assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(m=>m[1]),vectors.map(v=>v.id));
        assert.match(output,new RegExp('PASS '+count+' complete generated command vectors twice'));
        if(octets.length)assert.match(run(binary,[probes],build.runner),/PASS 258 complete generated command vectors twice/);
        if(interoperability.length)assert.match(run(binary,[interoperabilityPath],build.runner),/PASS 4 complete generated command vectors twice/);
      }
      const maximum=wasm(build.wasmBytes,vectors,inputCap,outputCap,pages);if(octets.length)wasm(build.probeWasm,octets,2,2,16);
      if(interoperability.length)wasm(build.wasmBytes,interoperability,inputCap,outputCap,pages);
      builds[kind]=build;t.diagnostic(JSON.stringify({kind,source:build.verified.source_id,attestation:build.verified.attestation_id,ir:build.generation.ir_sha256,wasm:sha(build.wasmBytes),maximum}));
    });
  }
  return builds;
}
