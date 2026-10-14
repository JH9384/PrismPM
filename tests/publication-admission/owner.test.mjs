import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {verifyWire,verifyModelMutation,inventory,prerequisite} from './checks.mjs';
import {frozenInputs,prepare} from './compile.mjs';
import {captureCompilerInputs,createCompilerOwner,requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {captureVerificationProducts} from '../browser-view/verification-products.mjs';

test('OC-09 owns distinct source publication stages and preserves public deployment refusal', () => {
  const source = readFileSync(new URL('../../stdlib/src/Production/PublicationAdmission/V1.lex.tex', import.meta.url), 'utf8');
  assert.match(source, /publicationTransition/);
  const lifecycle = readFileSync(new URL('../../crates/prismpm/src/lifecycle.rs', import.meta.url), 'utf8');
  assert.match(lifecycle, /GitHub Pages publication uses its protected Pages workflow/);
  const inputs=frozenInputs();
  for(const path of ['tests/publication-admission/src/Fixture.lex.tex',
    'stdlib/src/Production/PublicationAdmission/V1.lex.tex',
    'stdlib/src/Production/PublicationAdmission/V1Wire.lex.tex','stdlib/src/Foundation/Bytes.lex.tex',
    'stdlib/src/Foundation/Codec.lex.tex','stdlib/src/Foundation/Codec/Cbor/V1/Primitive.lex.tex',
    'tests/publication-admission/driver/Cargo.toml','tests/publication-admission/driver/Cargo.lock',
    'tests/publication-admission/driver/src/main.rs',
    'vendor/lexlean/Cargo.toml','vendor/lean4-prod/rust/Cargo.toml',
    'sdk/browser/effects-wire.mjs','sdk/browser/identity.mjs','model/authorities.toml',
    'model/publication-admission-diagnostics.json','LICENSE-MIT','LICENSE-APACHE']) {
    assert.equal(typeof inputs[path],'string');
    assert.throws(()=>prepare(null,{...inputs,[path]:'0'.repeat(64)}),/owning input closure changed before compilation/);
  }
  const compilerInputs=captureCompilerInputs('publication');
  assert.equal(typeof compilerInputs['tests/publication-admission/driver/src/main.rs'],'string');
  for(const path of ['tests/publication-admission/driver/src/main.rs','vendor/lean4-prod/lean.tar']){
    const missing={...compilerInputs};delete missing[path];
    assert.throws(()=>createCompilerOwner('publication',missing),/complete closed compiler input closure/);
  }
  assert.throws(()=>createCompilerOwner('publication',{...compilerInputs,unexpected:'0'.repeat(64)}),/complete closed compiler input closure/);
  assert.throws(()=>createCompilerOwner('publication',{...compilerInputs,'lean-toolchain':'0'.repeat(64)}),/captured compiler source/);
  assert.throws(()=>requireCompilerOwner({evidence:{family:'publication'}},'publication'),/actual fresh compiler owner/);
});

test('OC-09 complete generated conditional publication admission', {timeout:3500000}, async t=>{
 const inputs=frozenInputs(),compiler=createCompilerOwner('publication',captureCompilerInputs('publication'));
 let retired=false,retirementAttempted=false;
 t.after(()=>{if(!retired&&!retirementAttempted)compiler.close();});
 const substitutions=verifyCompilerOwnerSubstitutions(compiler),started=performance.now();
 const build=await verifyWire(t,inputs,compiler),mutants=[];
 await prerequisite(t,'closed protocol diagnostics and complete independent wire shape',inventory);
 for(const kind of['binding','coverage','timeline','trailing','preimage','partition'])mutants.push(await prerequisite(t,'actual LexLean '+kind+' defect fails native and Wasm',()=>verifyModelMutation(kind,inputs,compiler)));
 assert.deepEqual(frozenInputs(),inputs,'immutable complete owning source/tool input closure');
 for(const subject of [build,...mutants]){
  assert.equal(subject.compiler.identity,compiler.identity,'one actual fresh tool construction for all seven independent subjects');
  assert.equal(subject.cacheRetirement,null,'borrowed compiler tools are not yet retired');
 }
 const subjectMilliseconds=performance.now()-started;
 const products=captureVerificationProducts(build.work,'publication');
 retirementAttempted=true;const cacheRetirement=compiler.close();retired=true;
 assert.deepEqual(frozenInputs(),inputs,'complete publication inputs changed during final compiler retirement');
 assert.deepEqual(captureVerificationProducts(build.work,'publication'),products,
  'complete generated products unchanged through compiler retirement');
 build.verifyEvidence();
 assert.equal(cacheRetirement.status,'retired');assert.equal(cacheRetirement.compiler,compiler.identity);
 assert.throws(()=>requireCompilerOwner(compiler,'publication'),/compiler owner closed/);
 assert.throws(()=>compiler.close(),/compiler owner closed/);
 const evidence={capability:'OC-09',scope:'conditional-source-admission-only',source:build.verified.source_id,attestation:build.verified.attestation_id,maximum:build.maximum,mutants,inputs,
  compiler:build.compiler,substitutions,cacheRetirement,subjectMilliseconds};
 writeFileSync(join(build.work,'publication-acceptance.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 t.diagnostic(JSON.stringify({capability:'OC-09',scope:evidence.scope,compiler:compiler.identity,
  exporterBuildMs:compiler.evidence.exporterBuildMs,driverBuildMs:compiler.evidence.driverBuildMs,
  preparationMs:compiler.evidence.preparationMs,subjectMilliseconds,subjects:1+mutants.length,cacheRetirement}));
});
