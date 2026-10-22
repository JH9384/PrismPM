import assert from 'node:assert/strict';
import {lstatSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import test from 'node:test';
import {verifyVectors,verifyMaxima,verifySizeMaxima,verifyModelMutation,verifyInventory,verifyArtifactSubstitutions,frozenInputs,prerequisite} from '../../tests/browser-session/checks.mjs';
import {mutations} from '../../tests/browser-session/mutations.mjs';
import {sha} from '../../tests/browser-session/compile.mjs';
import {captureCompilerInputs,createCompilerOwner,requireCompilerOwner} from '../../tests/browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../../tests/browser-view/compiler-owner-checks.mjs';

const source = name => JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(
  new URL('../../stdlib/src/Foundation/Browser/Application/V1/' + name + '.lex.tex', import.meta.url), 'utf8'))[1]);

function retainedProducts(inventory,builds) {
 assert.equal(inventory.scope,'original-test-products-only');
 assert.equal(inventory.snapshots.length,22,'actual baseline and all21 independently generated mutants');
 assert.equal(builds.length,22);assert.equal(new Set(inventory.snapshots.map(row=>row.source)).size,22);
 for(const build of builds) {
  const capture=build.workspaceRetirement.productCapture;
  assert.deepEqual(inventory.snapshots.find(row=>row.source===capture.source),capture,'every actual retirement joined');
  assert.equal(lstatSync(capture.source,{throwIfNoEntry:false}),undefined,'original workspace genuinely deleted');
  const bytes=readFileSync(join(capture.directory,'capture.json'));
  assert.equal(sha(bytes),capture.manifest_sha256,'actual retained manifest bytes');
  const manifest=JSON.parse(bytes);assert.equal(manifest.source,capture.source);
  const rows=new Map(manifest.original.rows.map(row=>[row.path,row]));
  function file(path,digest,length) {
   const row=rows.get(path);assert.equal(row?.kind,'file',path);assert.equal(row.sha256,digest,path);
   if(length!==undefined) assert.equal(row.identity.size,String(length),path);
   return row;
  }
  file('export/kernel.ir',build.ir);
  const verified=relative(capture.source,build.provenance.verified.root);
  assert(verified&&!verified.startsWith('..')&&!verified.startsWith('/'),'verified kernel belongs to actual workspace');
  for(const [path,evidence] of [['build-manifest.json',build.provenance.manifest],['attestation.json',build.provenance.attestation]])
   file(verified+'/'+path,evidence.sha256,evidence.byte_length);
  for(const row of build.provenance.sources) file('project/'+row.path,row.sha256,row.byte_length);
  for(const row of build.provenance.outputs) file(verified+'/'+row.path,row.sha256,row.byte_length);
  for(const [label,files] of Object.entries(build.generatedPackages))
   for(const [path,digest] of Object.entries(files)) file((label==='native'?'generated':'guest-'+label)+'/'+path,digest);
  for(const artifact of [...Object.values(build.native),...Object.values(build.wasmArtifacts),
   ...Object.values(build.observers??{}).map(row=>row.evidence)]) for(const evidence of [artifact.original,artifact.private]) {
    const row=file(evidence.path,evidence.sha256,evidence.size);
    for(const [field,key] of [['dev','device'],['ino','inode'],['nlink','links']]) assert.equal(row.identity[field],evidence[key]);
  }
 }
}

test('DK-26 declares source-owned transitions and a closed canonical byte entry', () => {
  const model = source('Session'), wire = source('SessionWire');
  const declarations = new Map(model.declarations.map(row => [row.name, row]));
  for (const name of ['initializeSourceSession', 'readOnlySourceSession', 'beginSourceCommand',
    'settleSourceCommand', 'continueSourceCommand', 'unknownSourceCommand', 'closeSourceSession',
    'rebindSourceSession', 'sourceSessionContextValid']) assert.equal(declarations.get(name)?.kind, 'definition', name);
  assert.equal(wire.declarations.find(row => row.name === 'sourceSessionWireBytes')?.result.kind, 'bytes');
});

test('DK-26 actual source-owned session kernel, complete limits and guard mutations',{timeout:3500000},async t=>{
 const inputs=frozenInputs(),inventory=verifyInventory();
 const compiler=createCompilerOwner('session',captureCompilerInputs('session'));
 let retired=false,retirementAttempted=false;
 t.after(()=>{if(!retired&&!retirementAttempted)compiler.close();});
 const substitutions=verifyCompilerOwnerSubstitutions(compiler);
 const actual=await prerequisite(t,'complete source/kernel/axiom closure and every finite vector in native std/no_std and Wasm',()=>verifyVectors(undefined,inputs,compiler));
 const build=actual.build;
 const artifactSubstitutions=verifyArtifactSubstitutions(build);
 const maxima=await prerequisite(t,'all combined aggregate boundaries and input one-over in actual generated execution',()=>verifyMaxima(build));
 const domains=await prerequisite(t,'maximum Guest/Object/Head result domains and exact one-over rejection',()=>verifyMaxima(build,true));
 const sizes=await prerequisite(t,'all full presentation shapes and maximum Commit writer/error/size parity',()=>verifySizeMaxima(build));
 await prerequisite(t,'closed kernel diagnostics, budgets and owning inventories',verifyInventory);
 const mutants=[];
 for(const mutation of mutations)mutants.push(await prerequisite(t,'actual source mutation '+mutation.id+' fails native std/no_std and Wasm behavioral assertions',()=>{
  assert.deepEqual(frozenInputs(),inputs,'immutable source/tool inputs before each genuine mutation');
  return verifyModelMutation(mutation.id,build.sources,inputs,compiler);
 }));
 assert.deepEqual(frozenInputs(),inputs,'immutable complete owning source/tool input closure');
 build.unchanged();
 const native=build.nativeEvidence(),wasmArtifacts=Object.fromEntries(Object.entries(build.wasmArtifacts).map(([name,value])=>[name,value.evidence]));
 const observers=build.observerEvidence();
 assert.equal(Object.keys(observers).length,12,'all actual grant, aggregate, domain and writer observers retained until retirement');
 retirementAttempted=true;
 const workspaceRetirement=build.close(true),cacheRetirement=workspaceRetirement.compilerRetirement;retired=true;
 retainedProducts(workspaceRetirement.productInventory,[...mutants,{ir:build.generation.ir_sha256,
  provenance:build.provenance,generatedPackages:build.generatedPackages,native,wasmArtifacts,observers,workspaceRetirement}]);
 assert.equal(cacheRetirement.status,'retired');assert.equal(cacheRetirement.compiler,compiler.identity);
 assert.throws(()=>requireCompilerOwner(compiler,'session'),/compiler owner closed/);
 assert.throws(()=>compiler.close(),/compiler owner closed/);
 const evidence={capability:'DK-26',scope:'private-pure-kernel',source:build.verified.source_id,attestation:build.verified.attestation_id,
  ir:build.generation.ir_sha256,wasm:sha(build.wasmBytes),fixture:sha(build.fixtureBytes),size:sha(build.sizeBytes),inventory,
  observed:{wire:actual.wasm,fixture:actual.fixture,size:actual.size},maxima,domains,sizes,mutants,inputs,
  compiler:compiler.evidence,substitutions,artifactSubstitutions,cacheRetirement,workspaceRetirement,
  provenance:build.provenance,generatedPackages:build.generatedPackages,native,wasmArtifacts,observers};
 t.diagnostic(JSON.stringify(evidence));
});
