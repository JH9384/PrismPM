// Unchanged literal I/O projection copied from the owning modeled corpus gate.
import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {repository,sha} from "../../tests/browser-query/compile.mjs";
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
