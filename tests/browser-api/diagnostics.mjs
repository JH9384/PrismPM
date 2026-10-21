// Defensive-only exports append to exact production bytes in an isolated page.
import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';

export async function verifyDiagnostics(kind,build,publicCodes){
 assert.ok(['Command','Query'].includes(kind));
 const stem=kind==='Command'?'commands':'queries',errorClass=kind+'AdapterError';
 const source=readFileSync(new URL('../../sdk/browser/'+stem+'.mjs',import.meta.url),'utf8');
 const registry=readFileSync(new URL('../../model/browser-adapter-diagnostics.toml',import.meta.url),'utf8');
 const section=registry.split('[[adapter]]').slice(1).find(s=>s.includes('error_class = "'+errorClass+'"'));
 assert.ok(section);const registered=[...section.matchAll(/^code = "([a-z-]+)"$/gm)].map(m=>m[1]);
 const actual=[...new Set([...source.matchAll(/(?:fail|(?:Command|Query)AdapterError)\('([a-z-]+)'/g)].map(m=>m[1]))].sort();
 assert.deepEqual(actual,registered,'complete class-specific production diagnostic sites');
 const modelSource=readFileSync(new URL('../../stdlib/src/Foundation/Browser/V1/Workspace'+kind+'.lex.tex',import.meta.url),'utf8');
 const model=readSemantic(modelSource);
 const constructors=model.declarations.find(d=>d.name==='Workspace'+kind+'Error').constructors.map(c=>c.name);
 const rejections=[...section.matchAll(/^byte = ([0-9]+)\nname = "([A-Za-z]+)"$/gm)].map(m=>({byte:Number(m[1]),name:m[2]}));
 assert.deepEqual(rejections,constructors.map((name,index)=>({byte:index+1,name})),'exact generated rejection constructor table');
 const suffix='\nexport const __negativeBoundary=Object.freeze({hashBytes,interpreter,capture,output:'+(kind==='Command'?'plan':'page')+'});\n';
 assert.ok(!source.includes('__negativeBoundary'));
 const served=source+suffix;assert.equal(served.slice(0,-suffix.length),source);
 const result=await withBrowser(async({browser,baseURL})=>{
  const page=await browser.newPage();await page.route('**/'+stem+'.mjs',r=>r.fulfill({contentType:'text/javascript',body:served}));await page.goto(baseURL);
  return page.evaluate(async({kind,stem,bytes})=>{
   const api=await import('/'+stem+'.mjs'),guard=api.__negativeBoundary,module=await WebAssembly.compile(new Uint8Array(bytes));
   const codes=new Set(),cases=[];
   const reject=async(label,code,operation,detail=null)=>{let error;try{await operation();}catch(value){error=value;}
    if(error?.name!==kind+'AdapterError'||error.code!==code||error.detail!==detail)throw Error(label+': expected '+kind+' '+code+'/'+detail+', got '+error?.name+' '+error?.code+'/'+error?.detail);
    codes.add(code);cases.push(label);
   };
   for(const value of[null,0,[],'sha256:00','SHA256:'+'0'.repeat(64),'sha256:'+'g'.repeat(64)])await reject('invalid private hash','invalid-effect-result',()=>guard.hashBytes(value));
   await reject('wrong bootstrap module','invalid-generated-module',()=>guard.interpreter({}));
   await reject('actual guest over-allocation','request-limit',()=>guard.interpreter(module)(new Uint8Array(kind==='Command'?139874:1166280)));
   for(const bytes of[[],[0],[255],[0,255,255,255,0,0]])await reject('malformed generated framing','invalid-generated-output',()=>guard.output(new Uint8Array(bytes)));
   for(let value=1;value<=(kind==='Command'?12:13);value++)await reject('exact modeled detail '+value,kind==='Command'?'command-rejected':'query-rejected',()=>guard.output(new Uint8Array([value])),value);
   await reject('malformed closed intent','invalid-input',()=>guard.capture({state:new Uint8Array()}));
   const Instance=WebAssembly.Instance;
   try{
    for(const[mode,code]of[['missing','invalid-generated-module'],['pointer','invalid-generated-output'],['trap','generated-execution-failed']]){
     WebAssembly.Instance=class{constructor(...args){const real=new Instance(...args),exports={...real.exports};
      if(mode==='missing')delete exports.holo_run;
      if(mode==='pointer')exports.holo_alloc=()=>0xffffffff;
      if(mode==='trap')exports.holo_run=()=>{throw new WebAssembly.RuntimeError('planted guest failure');};
      return{exports};
     }};
     await reject('negative-only actual guest '+mode,code,()=>guard.interpreter(module)(new Uint8Array([255])));
    }
   }finally{WebAssembly.Instance=Instance;}
   const open=store=>kind==='Command'?api.openCommands({commandModule:module,store}):api.openQueries({queryModule:module,store});
   await reject('missing persisted identity','identity-missing',()=>open({loadIdentity:async()=>null}));
   await reject('unknown bootstrap storage outcome','storage-outcome-unknown',()=>open({loadIdentity:async()=>{throw Error('private source must not escape');}}));
   return{cases,codes:[...codes].sort()};
  },{kind,stem,bytes:Array.from(build.wasmBytes)});
 });
 assert.deepEqual([...new Set([...publicCodes,...result.codes])].sort(),registered,
  'every registered diagnostic is reached by a real public journey or identified defensive boundary');
 return{cases:result.cases,diagnostics:registered,sourceSha256:createHash('sha256').update(source).digest('hex')};
}
