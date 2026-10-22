import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {CORPUS_CASES,corpus} from './corpus.mjs';
import {mutations,mutateP256Source,canonical} from './mutations.mjs';
import {verifyNativeParameters,parameters} from './parameters.mjs';
import {coherentlyRehashedManifest} from './checks.mjs';

test('coherent-rehash adversary preserves canonical manifest bytes including the final newline', () => {
  const original = Buffer.from('{"files":[{"path":"src/lib.rs","sha256":"' + '0'.repeat(64) + '"}]}\n');
  const library = Buffer.from('actual changed source fixture'), digest = createHash('sha256').update(library).digest('hex');
  const changed = coherentlyRehashedManifest(original, library);
  assert.deepEqual(changed, Buffer.from('{"files":[{"path":"src/lib.rs","sha256":"' + digest + '"}]}\n'));
  assert.throws(() => coherentlyRehashedManifest(Buffer.from('{"files":[]}\n'), library), /one actual generated library/);
});

test('complete independent finite corpus and every named source counterexample are present',()=>{
  const rows=corpus();assert.equal(rows.length,CORPUS_CASES);assert.equal(mutations.length,22);
  assert.equal(new Set(mutations.map(row=>row.id)).size,22);
  for(const mutation of mutations)assert.equal(rows.filter(row=>row.id===mutation.probe).length,1,mutation.id);
  assert.equal(rows.filter(row=>row.id.startsWith('CAVP-')).length,12);
  assert.equal(rows.filter(row=>row.id.startsWith('ACVP-')).length,3);
});

test('SEC2 parameter fixture agrees with independent native named-curve implementation',()=>{
  verifyNativeParameters();
  const text=readFileSync(new URL('../../stdlib/src/Foundation/Crypto/P256/Model.lex.tex',import.meta.url),'utf8');
  const data=JSON.parse(/\\semanticdata\{(.*)\}/.exec(text)[1]);
  function limbs(name){let term=data.declarations.find(d=>d.name===name).body,result=0n,place=1n,count=0;
    while(term.constructor.name==='List.cons'){assert.equal(term.arguments[0].kind,'nat');
      result+=BigInt(term.arguments[0].value)*place;place*=65536n;term=term.arguments[1];count++;}
    assert.equal(term.constructor.name,'List.nil');assert.equal(count,17);return result;}
  assert.equal(limbs('p256Modulus'),BigInt('0x'+parameters.p));
  assert.equal(limbs('p256CurveB'),BigInt('0x'+parameters.b));
  assert.equal(BigInt('0x'+parameters.a),BigInt('0x'+parameters.p)-3n);
});

test('baseline and all actual authored mutants retain canonical semantic serialization',()=>{
  const source=new Map(['Model','Wire'].map(name=>['Foundation.Crypto.P256.'+name,
    readFileSync(new URL('../../stdlib/src/Foundation/Crypto/P256/'+name+'.lex.tex',import.meta.url))]));
  for(const id of [null,...mutations.map(row=>row.id)]){
    const candidate=new Map(source);if(id)mutateP256Source(candidate,id);
    for(const bytes of candidate.values()){
      const serialized=/\\semanticdata\{(.*)\}/.exec(bytes.toString())[1];
      assert.equal(serialized,JSON.stringify(canonical(JSON.parse(serialized))),id??'baseline');
    }
  }
});

test('right-half defect preserves structural descent and changes accumulated state',()=>{
  const path=new URL('../../stdlib/src/Foundation/Crypto/P256/Model.lex.tex',import.meta.url);
  const source=new Map([['Foundation.Crypto.P256.Model',readFileSync(path)]]);
  mutateP256Source(source,'right-half');
  const data=JSON.parse(/\\semanticdata\{(.*)\}/.exec(source.get('Foundation.Crypto.P256.Model').toString())[1]);
  const declaration=data.declarations.find(row=>row.name==='p256MultiplyTree');
  const right=declaration.body.branches[1].body.branches[1].body;
  assert.deepEqual(right.arguments[2],{kind:'var',name:'prior'});
  assert.deepEqual(right.arguments[1],{kind:'record',type:{name:'P256MultiplyState'},fields:[
    {field:'accumulator',value:{kind:'project',field:'accumulator',value:{kind:'var',name:'current'}}},
    {field:'factor',value:{kind:'project',field:'factor',value:{kind:'var',name:'leftState'}}},
    {field:'index',value:{kind:'project',field:'index',value:{kind:'var',name:'leftState'}}},
  ]});
});
