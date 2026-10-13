import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {verifyWire,verifyModelMutation,inventory,prerequisite} from './checks.mjs';
import {frozenInputs,prepare} from './compile.mjs';
import {createCompilerOwner,requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
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
});

test('OC-09 complete generated conditional publication admission', {timeout:3500000}, async t=>{
 const inputs=frozenInputs(),owner=createCompilerOwner('publication');
 const substitutions=verifyCompilerOwnerSubstitutions(owner);
 const build=await verifyWire(t,inputs,owner),mutants=[];
 assert.equal(build.compilerOwner,owner.identity);
 await prerequisite(t,'closed protocol diagnostics and complete independent wire shape',inventory);
 for(const kind of['binding','coverage','timeline','trailing','preimage','partition'])mutants.push(await prerequisite(t,'actual LexLean '+kind+' defect fails native and Wasm',()=>verifyModelMutation(kind,inputs,owner)));
 const products=captureVerificationProducts(build.work,'publication');
 const retirement=owner.close();
 assert.deepEqual(captureVerificationProducts(build.work,'publication'),products,
  'complete generated products unchanged through compiler retirement');
 build.verifyEvidence();
 assert.throws(()=>requireCompilerOwner(owner,'publication'),/compiler owner closed/);
 assert.throws(()=>owner.close(),/compiler owner closed/);
 assert.deepEqual(frozenInputs(),inputs,'immutable complete owning source/tool input closure');
 writeFileSync(join(build.work,'publication-acceptance.json'),JSON.stringify({capability:'OC-09',scope:'conditional-source-admission-only',source:build.verified.source_id,attestation:build.verified.attestation_id,maximum:build.maximum,mutants,inputs,cacheRetirement:retirement,compiler:owner.identity},null,2)+'\n',{flag:'wx'});
 t.diagnostic(JSON.stringify({compiler:owner.evidence,substitutions,retirement}));
});
