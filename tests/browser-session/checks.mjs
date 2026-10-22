import assert from 'node:assert/strict';
import {chmodSync,copyFileSync,linkSync,lstatSync,mkdirSync,readFileSync,renameSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, run, sha, draft, repository, frozenInputs, assertFrozenInputs} from './compile.mjs';
import {corpus, wrapperCorpus, maximumGrantVector} from './corpus.mjs';
import {maximumVectors, effectResultMaxima} from './maxima.mjs';
import {sizeCorpus, sizeMaxima} from './size-corpus.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
import {mutations} from './mutations.mjs';
import {captureCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {captureFile,capturedFile} from '../browser-view/file-custody.mjs';
export {prerequisite} from '../browser-view/prerequisites.mjs';
export {frozenInputs} from './compile.mjs';

export function executeWasm(bytes, vectors) {
 const limits = inspectEffectModule(bytes, 16384), module = new WebAssembly.Module(bytes);
 assert.deepEqual(WebAssembly.Module.imports(module), []); assert.equal(limits.maximumPages, 16384);
 let maximum = 0;
 for (const vector of vectors) for (let repeat = 0; repeat < 2; repeat++) {
  const instance = new WebAssembly.Instance(module, {});
  const pointer = instance.exports.holo_alloc(vector.request.length) >>> 0;
  assert.ok(pointer + vector.request.length <= instance.exports.memory.buffer.byteLength);
  new Uint8Array(instance.exports.memory.buffer, pointer, vector.request.length).set(vector.request);
  const packed = BigInt.asUintN(64, instance.exports.holo_run(pointer, vector.request.length));
  const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
  assert.ok(length <= 67108864 && at + length <= instance.exports.memory.buffer.byteLength);
  assert.ok(Buffer.from(new Uint8Array(instance.exports.memory.buffer, at, length)).equals(Buffer.from(vector.response)), vector.id + ' actual generated Wasm response');
  maximum = Math.max(maximum, instance.exports.memory.buffer.byteLength);
  assert.ok(maximum <= 1073741824);
 }
 const invalid = new WebAssembly.Instance(module, {});
 assert.throws(() => invalid.exports.holo_alloc(67108865), WebAssembly.RuntimeError);
 assert.throws(() => invalid.exports.memory.grow(16384), RangeError);
 return {maximumBytes: maximum, declaredPages: limits.maximumPages};
}

export const tsv = vectors => vectors.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex') + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');

function supervised(build,command,args,artifacts=[],files=[]) {
 const captures=files.map(path=>[path,captureFile(path).evidence]);
 const verify=()=>{
  build.unchanged();for(const artifact of artifacts)artifact.verify();
  for(const [path,evidence] of captures)capturedFile(path,evidence);
 };
 verify();try{return run(command,args,build.work);}finally{verify();}
}

function maximumNative(build,standard,name) {
 return build.registerObserver(name,captureCompilerArtifact(build.work,build.compileNative(standard),name),'native');
}

function maximumWasm(build,bytes,name) {
 const original=join(build.work,name+'-original.wasm');writeFileSync(original,bytes,{flag:'wx'});
 return build.registerObserver(name,captureGeneratedWasm(build.work,original,name),'wasm');
}

function supervisedNative(build,standard,args,files) {
 return supervised(build,build.compileNative(standard),args,[],files);
}

// Mutate actual just-built observer artifacts, not invented acceptance records.
export function verifyArtifactSubstitutions(build) {
 const controls=[];
 function changedFile(path,pattern,label) {
  const original=readFileSync(path),changed=Buffer.from(original);changed[changed.length-1]^=1;
  const mode=lstatSync(path).mode&0o777;
  try {
   chmodSync(path,0o700);writeFileSync(path,changed);
   assert.throws(()=>build.unchanged(),pattern,label+' changed bytes');
  }finally{writeFileSync(path,original);chmodSync(path,mode);}
  build.unchanged();controls.push(label+'-bytes');
  const saved=path+'.original-inode';renameSync(path,saved);
  try {
   copyFileSync(saved,path);
   assert.throws(()=>build.unchanged(),pattern,label+' same-byte replacement');
  }finally{unlinkSync(path);renameSync(saved,path);}
  build.unchanged();controls.push(label+'-inode');
 }
 for(const standard of [true,false]) {
  build.compileNative(standard);
  const mode=standard?'std':'no_std',evidence=build.nativeEvidence()[mode];
  for(const kind of ['original','private']) {
   const path=join(build.work,evidence[kind].path);
   changedFile(path,/immutable (original|private) compiler|compiler link count/,mode+'-'+kind);
   const link=path+'.extra-link';linkSync(path,link);
   try{assert.throws(()=>build.unchanged(),/compiler link count/);}finally{unlinkSync(link);}
   build.unchanged();controls.push(mode+'-'+kind+'-hard-link');
  }
 }
 for(const [name,artifact] of Object.entries(build.wasmArtifacts)) {
  for(const kind of ['original','private'])changedFile(join(build.work,artifact.evidence[kind].path),
   /immutable (original|private) generated Wasm|generated Wasm link count/,name+'-'+kind);
  artifact.bytes[artifact.bytes.length-1]^=1;
  try{assert.throws(()=>build.unchanged(),/immutable execution Wasm buffer/);}
  finally{artifact.bytes[artifact.bytes.length-1]^=1;}
  build.unchanged();controls.push(name+'-buffer');
 }
 const extra=join(build.work,'generated','unexpected-output');writeFileSync(extra,'unaccepted',{flag:'wx'});
 try{assert.throws(()=>build.unchanged(),/complete generated package file inventory/);}
 finally{unlinkSync(extra);}
 build.unchanged();controls.push('native-package-extra');
 const saved=build.work+'.captured-root';renameSync(build.work,saved);
 try {
  mkdirSync(build.work,{mode:0o700});
  assert.throws(()=>build.unchanged(),/session workspace root identity/,'same-name private workspace replacement');
 }finally{rmdirSync(build.work);renameSync(saved,build.work);}
 build.unchanged();controls.push('workspace-root-inode');
 assert.equal(controls.length,44,'complete native/Wasm package and workspace substitution inventory');
 return Object.freeze(controls);
}

export function verifyInventory() {
 const model=JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(join(repository,'stdlib/src/Foundation/Browser/Application/V1/Session.lex.tex'),'utf8'))[1]);
 const errors=model.declarations.find(row=>row.name==='SourceSessionError').constructors.map(row=>row.name);
 assert.deepEqual(errors,['BadLimits','BadBinding','BadManifest','BadState','BadAuthority','BadView','BadIntent','SecretInput','Busy',
  'OutcomeUnknown','Closed','SequenceExhausted','RevisionExhausted','CommandMismatch','PlanMismatch','CompletionMismatch','StepExhausted','WrongExecution','ContextMismatch','FrameExhausted']);
 const fields=model.declarations.find(row=>row.name==='SourceSessionLimits').fields;
 assert.deepEqual(fields.map(row=>row.name),['applicationMaximum','selectorMaximum','continuationMaximum','evidenceMaximum','intentMaximum','maximumSteps','presentationMaximum']);
 assert.ok(fields.every(row=>row.type.kind==='nat'));
 assert.equal(corpus().length,895);assert.equal(wrapperCorpus().length,7);assert.equal(sizeCorpus().length,686);
 assert.equal(mutations.length,21);assert.equal(new Set(mutations.map(row=>row.id)).size,21);
 const covered=new Set(corpus().filter(row=>row.response[0]===0x83&&row.response[1]===1&&row.response[2]===1).map(row=>row.response[3]));
 assert.deepEqual([...covered].sort((a,b)=>a-b),Array.from({length:20},(_,index)=>index));
 return {protocol:895,sourceWrapper:7,writerParity:686,sessionMaxima:18,effectDomainMaxima:9,writerMaxima:18,sourceMutants:21};
}

// Diagnostic full generated execution; the owning gate additionally requires
// declared aggregate maxima, exact inventories and real source guard mutants.
export function verifyVectors(build, inputs = frozenInputs(), compiler = null) {
 assertFrozenInputs(inputs);
 build ??= prepare(null,null,inputs,compiler);
 const vectors = corpus(), wrapper = wrapperCorpus(), sizes = sizeCorpus();
 const path = join(build.work, 'session-corpus.tsv'), wrapperPath = join(build.work, 'wrapper-corpus.tsv'), sizePath = join(build.work, 'size-corpus.tsv');
 writeFileSync(path, tsv(vectors), {flag: 'wx'}); writeFileSync(wrapperPath, tsv(wrapper), {flag: 'wx'}); writeFileSync(sizePath, tsv(sizes), {flag: 'wx'});
 const maximumGrant = maximumGrantVector(), grantInput = join(build.work, 'grant-input.bin'), grantExpected = join(build.work, 'grant-expected.bin');
 writeFileSync(grantInput, maximumGrant.request, {flag: 'wx'}); writeFileSync(grantExpected, maximumGrant.response, {flag: 'wx'});
 const grantWasm=maximumWasm(build,build.wasmBytes,'grant-wire');
 for (const standard of [true, false]) {
  const observer=maximumNative(build,standard,'grant-'+(standard?'std':'no-std'));
  assert.ok(supervised(build,'/usr/bin/timeout', ['--signal=TERM', '--kill-after=1s', '3s', observer.path, '--binary', grantInput, grantExpected],[observer],[grantInput,grantExpected]).includes('PASS binary complete session vector twice'));
  const observed = supervisedNative(build,standard,[path],[path]), observedWrapper = supervisedNative(build,standard,['--fixture',wrapperPath],[wrapperPath]);
  assert.ok(observed.includes('PASS ' + vectors.length + ' complete session vectors twice'));
  assert.ok(observedWrapper.includes('PASS ' + wrapper.length + ' complete session vectors twice'));
  assert.ok(supervisedNative(build,standard,['--size',sizePath],[sizePath]).includes('PASS ' + sizes.length + ' complete session vectors twice'));
 }
 const boundedGrant = JSON.parse(supervised(build,'/usr/bin/timeout', ['--signal=TERM', '--kill-after=1s', '3s', process.execPath, join(draft, 'maximum-runner.mjs'), grantWasm.path, grantInput, grantExpected],[grantWasm],[grantInput,grantExpected]));
 assert.equal(boundedGrant.request, sha(maximumGrant.request)); assert.equal(boundedGrant.response, sha(maximumGrant.response));
 assertFrozenInputs(inputs);
 build.unchanged();
 return {build, vectors: vectors.length, wrapper: wrapper.length, sizes: sizes.length,
  wasm: build.wasmArtifacts.a.run(bytes=>executeWasm(bytes, vectors)),
  fixture:build.wasmArtifacts['fixture-a'].run(bytes=>executeWasm(bytes,wrapper)),
  size:build.wasmArtifacts['size-a'].run(bytes=>executeWasm(bytes,sizes))};
}

export function verifyMaxima(build, domain=false) {
 const programs = [];
 for (const standard of [true, false]) {
  programs.push(maximumNative(build,standard,(domain?'domain-':'')+(standard?'maximum-std':'maximum-no-std')));
 }
 const prefix=domain?'domain-maximum':'maximum';
 const input = join(build.work, prefix+'-input.bin'), expected = join(build.work, prefix+'-expected.bin');
 const wasm=maximumWasm(build,build.wasmBytes,prefix+'-wire');
 const evidence = [];
 for (const vector of (domain?effectResultMaxima():maximumVectors())) {
  writeFileSync(input, vector.request); writeFileSync(expected, vector.response);
  for (const program of programs) assert.ok(supervised(build,program.path, ['--binary', input, expected],[program],[input,expected]).includes('PASS binary complete session vector twice'));
  const observed = JSON.parse(supervised(build,process.execPath, [join(draft, 'maximum-runner.mjs'), wasm.path, input, expected],[wasm],[input,expected]));
  assert.equal(observed.request, sha(vector.request)); assert.equal(observed.response, sha(vector.response));
  assert.ok(observed.maximumBytes <= 1073741824); assert.equal(observed.declaredPages, 16384);
  const result = {id: vector.id, requestBytes: vector.request.length, responseBytes: vector.response.length, ...observed};
  console.log(JSON.stringify(result)); evidence.push(result);
 }
 assert.equal(evidence.length, domain?9:18, 'closed actual maximum inventory');
 if(!domain) {
  writeFileSync(input,new Uint8Array(67108865));writeFileSync(expected,Uint8Array.of(0x83,1,2,6));
  for(const program of programs)assert.ok(supervised(build,program.path,['--binary',input,expected],[program],[input,expected]).includes('PASS binary complete session vector twice'));
 }
 writeFileSync(join(build.work, prefix+'-evidence.json'), JSON.stringify(evidence) + '\n', {flag: 'wx'});
 build.unchanged();
 return evidence;
}

export function verifySizeMaxima(build) {
 const programs=[];
 for(const standard of [true,false]) {
  programs.push(maximumNative(build,standard,standard?'size-std':'size-no-std'));
 }
 const input=join(build.work,'size-maximum-input.bin'),expected=join(build.work,'size-maximum-expected.bin');
 const wasm=maximumWasm(build,build.sizeBytes,'size-maximum');const evidence=[];
 for(const vector of sizeMaxima()) {
  writeFileSync(input,vector.request);writeFileSync(expected,vector.response);
  for(const program of programs)assert.ok(supervised(build,program.path,['--size-binary',input,expected],[program],[input,expected]).includes('PASS binary complete session vector twice'));
  const observed=vector.nativeOnly?{nativeOnly:true,request:sha(vector.request),response:sha(vector.response)}
   :JSON.parse(supervised(build,process.execPath,[join(draft,'maximum-runner.mjs'),wasm.path,input,expected],[wasm],[input,expected]));
  assert.equal(observed.request,sha(vector.request));assert.equal(observed.response,sha(vector.response));
  const row={id:vector.id,input:vector.request.length,output:vector.response.length,...observed};
  console.log(JSON.stringify(row));evidence.push(row);
 }
 assert.equal(evidence.length,18,'nine complete maximum views, input one-over, four Commit counts and four full-completion equality maxima');
 writeFileSync(join(build.work,'size-maximum-evidence.json'),JSON.stringify(evidence)+'\n',{flag:'wx'});build.unchanged();return evidence;
}

export function verifyModelMutation(id, baseline, inputs, compiler = null) {
 assertFrozenInputs(inputs);
 const mutation=mutations.find(row=>row.id===id); assert.ok(mutation);
 const findMaximum=()=>{for(const row of maximumVectors())if(row.id===mutation.vector)return row;};
 const vector=mutation.maximum ? findMaximum()
  : (mutation.fixture?wrapperCorpus():corpus()).find(row=>row.id===mutation.vector);
 assert.ok(vector, 'exact behavioral counterexample '+id);
 const build=prepare(id, baseline, inputs, compiler);
  const file=join(build.work,'mutation.tsv'), input=join(build.work,'mutation-input.bin'), expected=join(build.work,'mutation-expected.bin');
  if(mutation.maximum) {writeFileSync(input,vector.request,{flag:'wx'});writeFileSync(expected,vector.response,{flag:'wx'});}
  else writeFileSync(file,tsv([vector]),{flag:'wx'});
  for(const standard of [true,false]) {
   const args=mutation.maximum?['--binary',input,expected]:mutation.fixture?['--fixture',file]:[file];
   assert.throws(()=>supervisedNative(build,standard,args,mutation.maximum?[input,expected]:[file]),/native output mismatch/);
  }
  const wasm=mutation.fixture?build.fixtureBytes:build.wasmBytes;
  const artifact=Object.values(build.wasmArtifacts)[0];
  assert.throws(()=>artifact.run(bytes=>executeWasm(bytes,[vector])),/actual generated Wasm response/);
  assertFrozenInputs(inputs);
  build.unchanged();
  const evidence={id,vector:vector.id,source:build.verified.source_id,attestation:build.verified.attestation_id,
   ir:build.generation.ir_sha256,wasm:sha(wasm),request:sha(vector.request),response:sha(vector.response),compiler:build.compiler,
   provenance:build.provenance,generatedPackages:build.generatedPackages,native:build.nativeEvidence(),
   wasmArtifacts:Object.fromEntries(Object.entries(build.wasmArtifacts).map(([name,value])=>[name,value.evidence]))};
  writeFileSync(join(build.work,'session-mutation-evidence.json'),JSON.stringify(evidence)+'\n',{flag:'wx'});
  evidence.workspaceRetirement=build.close();
  return evidence;
}
