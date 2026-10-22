// Diagnostic-reader fixtures only; never a browser/application oracle result.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,linkSync,renameSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {PortableDiagnosticBundle} from './portable-oracle-diagnostics.mjs';
import {retirementFaults} from './portable-oracle-retirement.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const workflowPath=join(sourceRoot,'.github/workflows/browser-input-interop.yml');
const workflow=readFileSync(workflowPath,'utf8');
const raw=workflow.split("<<'VERIFY_CHROMIUM_INTEROP'\n")[1].split('            VERIFY_CHROMIUM_INTEROP')[0];
const inline=raw.split('\n').map(line=>line.slice(12)).join('\n');
const imports=inline.slice(0,inline.indexOf('const node='))
  .replaceAll("from './scripts/","from '"+pathToFileURL(join(sourceRoot,'scripts')+'/').href);
const reader=imports+inline.slice(inline.indexOf('const bundles='));
const matrix=JSON.parse(readFileSync(join(sourceRoot,'tests/data/portable-oracle-matrix.json')));
const cases=matrix.profiles.flatMap((_,index)=>[
  ...matrix.triggers.flatMap(trigger=>matrix.interaction_cases.map(name=>`${index}-${trigger}-${name}`)),
  ...matrix.infrastructure_cases.map(name=>`${index}-click-${name}`)]);
const negatives=matrix.profiles.flatMap((_,index)=>[
  ...['wrong-status','noop'].map(name=>`${index}-probe-control-${name}`),
  ...matrix.triggers.flatMap(trigger=>['omit-finished','malformed-finished'].map(name=>`${index}-probe-control-${name}-${trigger}`))]);
const observations=matrix.profiles.flatMap((_,index)=>matrix.triggers.flatMap(trigger=>['observed','unobserved','ordinary'].map(mode=>`${index}-observation-${trigger}-${mode}`)));
const retirements=matrix.profiles.flatMap((_,index)=>retirementFaults.flatMap(fault=>
  (['pending-detach','rejected-detach','primary-body-failure'].includes(fault)?matrix.triggers:['click'])
    .map(trigger=>`${index}-retirement-${trigger}-${fault}`)));
const controls=['positive','empty-index-unindexed-outcomes','omitted-indexed-subject','foreign-output','duplicate-outcome','changed-payload','hardlinked-payload','symlink-payload','wrong-status','omitted-completion-negative','omitted-added-retirement','omitted-ordinary-observation'];
for(const control of controls)test('Chromium CI retained-reader '+control,()=>{
  const root=mkdtempSync(join(tmpdir(),'prismpm-ci-reader-fixture-'));
  try{
    // The expected source table is real, but all bundle contents here are
    // explicitly small reader fixtures, not execution or acceptance evidence.
    mkdirSync(join(root,'tests/data'),{recursive:true});
    writeFileSync(join(root,'tests/data/portable-oracle-matrix.json'),JSON.stringify(matrix));
    const bundle=new PortableDiagnosticBundle(root);
    bundle.json('source-witnesses.json',{fixture:true});
    for(const index of [0,1])for(const name of ['model','archive','wasm','verification'])bundle.bytes(`subjects/${index}-${name}`,Buffer.from('fixture'));
    for(const id of [...cases,...negatives,...observations,...retirements]){
      bundle.bytes(`cases/${id}.driver.mjs`,Buffer.from('// reader fixture\n'));
      bundle.json(`cases/${id}.json`,{fixture:true});
    }
    const result={cases:cases.map(id=>({id,status:'passed'})),negative_controls:negatives.map(id=>({id,status:'refused-as-required'})),retirement_controls:retirements.map(id=>({id,status:'passed'}))};
    if(control==='duplicate-outcome')result.cases[1].id=result.cases[0].id;
    if(control==='wrong-status')result.cases[0].status='failed';
    if(control==='omitted-completion-negative')result.negative_controls=result.negative_controls.filter(row=>row.id!=='0-probe-control-omit-finished-keyboard');
    if(control==='omitted-added-retirement')result.retirement_controls=result.retirement_controls.filter(row=>row.id!=='0-retirement-click-rejected-acquisition');
    bundle.finish(result,true);
    const indexed=join(bundle.path,'index.json'),payload=join(bundle.path,'subjects/0-model');
    if(control==='empty-index-unindexed-outcomes'){
      const index=JSON.parse(readFileSync(indexed));index.files=[];index.total_bytes=0;
      writeFileSync(indexed,JSON.stringify(index));
    }
    if(control==='omitted-indexed-subject'){
      const index=JSON.parse(readFileSync(indexed));const omitted=index.files.find(row=>row.path==='subjects/0-model');
      index.files=index.files.filter(row=>row!==omitted);index.total_bytes-=omitted.byte_length;
      writeFileSync(indexed,JSON.stringify(index));
    }
    if(control==='omitted-ordinary-observation'){
      const index=JSON.parse(readFileSync(indexed));const omitted=index.files.find(row=>row.path==='cases/0-observation-click-ordinary.driver.mjs');
      assert.ok(omitted);index.files=index.files.filter(row=>row!==omitted);index.total_bytes-=omitted.byte_length;
      writeFileSync(indexed,JSON.stringify(index));
    }
    if(control==='foreign-output')writeFileSync(join(bundle.path,'unindexed'), 'foreign');
    if(control==='changed-payload')writeFileSync(payload,'changed');
    if(control==='hardlinked-payload')linkSync(payload,join(root,'foreign-hardlink'));
    if(control==='symlink-payload'){
      renameSync(payload,join(root,'outside-payload'));symlinkSync(join(root,'outside-payload'),payload);
    }
    const execution=spawnSync(process.execPath,['--input-type=module'],{cwd:root,input:reader,encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.ifError(execution.error);assert.equal(execution.signal,null);
    assert.equal(execution.status,control==='positive'?0:1,`${control}: ${execution.stderr}`);
    if(control!=='positive')assert.match(execution.stderr,/AssertionError \[ERR_ASSERTION\]/,'actual reader assertion, not an import or execution failure');
    assert.equal(readFileSync(workflowPath,'utf8'),workflow,'reader source changed during control');
  }finally{rmSync(root,{recursive:true});}
});
