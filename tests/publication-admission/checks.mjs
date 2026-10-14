import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepare,run,sha,repository,frozenInputs} from './compile.mjs';
import {corpus,maximumCorpus,overFrame,records} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
export {prerequisite};
const tsv=rows=>rows.map(row=>row.id+'\t'+Buffer.from(row.request).toString('hex')+'\t'+Buffer.from(row.response).toString('hex')+'\n').join('');

export function executeWasm(bytes,vectors){
 const limits=inspectEffectModule(bytes,16384),module=new WebAssembly.Module(bytes);
 assert.deepEqual(WebAssembly.Module.imports(module),[]);assert.equal(limits.maximumPages,16384);
 let peak=0;
 for(const vector of vectors)for(let repeat=0;repeat<2;repeat++){
  const instance=new WebAssembly.Instance(module,{}),pointer=instance.exports.holo_alloc(vector.request.length)>>>0;
  assert.ok(pointer+vector.request.length<=instance.exports.memory.buffer.byteLength);
  new Uint8Array(instance.exports.memory.buffer,pointer,vector.request.length).set(vector.request);
  const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,vector.request.length)),at=Number(packed>>32n),length=Number(packed&0xffffffffn);
  assert.ok(length<=67108864&&at+length<=instance.exports.memory.buffer.byteLength);
  assert.ok(Buffer.from(new Uint8Array(instance.exports.memory.buffer,at,length)).equals(Buffer.from(vector.response)),vector.id+' generated Wasm output mismatch');
  peak=Math.max(peak,instance.exports.memory.buffer.byteLength);assert.ok(peak<=1073741824);
 }
 const invalid=new WebAssembly.Instance(module,{});assert.throws(()=>invalid.exports.holo_alloc(67108865),WebAssembly.RuntimeError);assert.throws(()=>invalid.exports.memory.grow(16384),RangeError);
 return {peak,maximumPages:16384};
}
export function inventory(){
 const semantic=name=>JSON.parse(readFileSync(join(repository,'stdlib/src',...name.split('.'))+'.lex.tex','utf8').match(/\\semanticdata\{(.*)\}/)[1]);
 const model=semantic('Production.PublicationAdmission.V1'),types=new Map(model.declarations.filter(row=>['structure','inductive'].includes(row.kind)).map(row=>[row.name,row]));
 const suffix={Trust:'TrustFact'};
 for(const [name,fields]of Object.entries(records))assert.deepEqual(types.get('Publication'+(suffix[name]??name)).fields.map(row=>row.name),fields.map(([field])=>field),'independent record wire order '+name);
 const diagnostics=JSON.parse(readFileSync(join(repository,'model/publication-admission-diagnostics.json')));
 assert.equal(diagnostics.capability,'OC-09');assert.deepEqual(diagnostics.protocol_errors,types.get('PublicationError').constructors.map(row=>row.name));
 assert.deepEqual(diagnostics.wire_errors,semantic('Foundation.Codec.Cbor.V1.Primitive').declarations.find(row=>row.name==='CborError').constructors.map(row=>row.name));
 const vectors=corpus(),maxima=maximumCorpus();assert.equal(vectors.length,373);assert.equal(maxima.length,24);
 for(const row of maxima)assert.ok(row.request.length<=67108864&&row.response.length<=67108864);
 assert.ok(maxima.find(row=>row.id==='CombinedStructuralMaximum').response.length>1000000);
 return {vectors:vectors.length,maxima:maxima.map(row=>({id:row.id,input:row.request.length,output:row.response.length}))};
}
export async function verifyWire(t,inputs=frozenInputs(),compilerOwner=null){
 const sources=inputs,vectors=corpus(),maxima=maximumCorpus(),bounds=inventory(),build=prepare(null,inputs,compilerOwner);
 const file=join(build.work,'vectors.tsv');writeFileSync(file,tsv(vectors),{flag:'wx'});
 const binaries=[...maxima,overFrame()].map(row=>{const input=join(build.work,row.id+'.request'),output=join(build.work,row.id+'.response');writeFileSync(input,row.request,{flag:'wx'});writeFileSync(output,row.response,{flag:'wx'});return {...row,input,output};});
 for(const standard of[true,false])await prerequisite(t,'complete publication corpus and combined maxima in generated '+(standard?'std':'no_std'),()=>{
  const binary=build.compileNative(standard),output=run(binary,[file],build.runner);
  assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row=>row[1]),vectors.map(row=>row.id));assert.match(output,/PASS 373 complete publication vectors twice/);
  for(const row of binaries)assert.equal(run(binary,['--binary',row.input,row.output],build.runner),'PASS binary complete publication vector twice\n');
 });
 await prerequisite(t,'actual generated Wasm repeats every transition and combined maximum',()=>{build.maximum=executeWasm(build.wasmBytes,[...vectors,...maxima]);});
 assert.deepEqual(frozenInputs(),sources);
 const evidence={source:build.verified.source_id,attestation:build.verified.attestation_id,ir:build.generation.ir_sha256,wasm:sha(build.wasmBytes),bounds,maximum:build.maximum,sources,cacheRetirement:build.cacheRetirement,compiler:build.compiler};
 writeFileSync(join(build.work,'publication-wire-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});t.diagnostic(JSON.stringify(evidence));return build;
}
export function verifyModelMutation(kind,inputs=frozenInputs(),compilerOwner=null){
 const selected={binding:'ContextChangedSubjectsource',coverage:'CoveragePreMissing',timeline:'DeploymentBeforeAuthorization',trailing:'Trailing',preimage:'ContextPreimageFieldinstance',partition:'FlatBoundary65Prepare'}[kind];
 const vector=corpus().find(row=>row.id===selected);assert.ok(vector);
 const build=prepare(kind,inputs,compilerOwner),file=join(build.work,'mutation.tsv');
 if(compilerOwner)assert.equal(build.compiler.identity,compilerOwner.identity);
 writeFileSync(file,tsv([vector]),{flag:'wx'});
 for(const standard of[true,false])assert.throws(()=>run(build.compileNative(standard),[file],build.runner),/native output mismatch/);
 assert.throws(()=>executeWasm(build.wasmBytes,[vector]),/generated Wasm output mismatch/);
 build.verifyEvidence();
 return {kind,source:build.verified.source_id,attestation:build.verified.attestation_id,ir:build.generation.ir_sha256,wasm:sha(build.wasmBytes),vector:vector.id,request:sha(vector.request),response:sha(vector.response),cacheRetirement:build.cacheRetirement,compiler:build.compiler};
}
