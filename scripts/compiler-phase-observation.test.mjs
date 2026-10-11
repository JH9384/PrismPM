// Numeric diagnostic infrastructure only, not compiler or model acceptance.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {phaseCollector} from './owning-node-reporter.mjs';
import {compilerPhase,repository} from '../tests/browser-view/compile.mjs';
import {captureCompilerArtifact} from '../tests/browser-view/compiler-artifact.mjs';
const prefix='# prismpm-compiler-phase ';
const row=(phase='kernel-export',elapsed_ms=12,success=true)=>({phase,elapsed_ms,success});
const encoded=value=>prefix+JSON.stringify(value)+'\n';
test('classifications are closed labels, not private paths or arguments',()=>{
  const driver='/private/driver-target/debug/browser-workspace-view-driver';
  const cases=[['cargo',['--version'],'toolchain-check'],['cargo',['build'],'rust-compilation'],
    ['tar',['-xf','/private/archive'],'archive-extraction'],['lake',['update'],'lake-update'],
    ['lake',['build','prod-export'],'exporter-construction'],['lake',['build','PrismGenerated'],'generated-module-build'],
    ['/private/prod-export',[],'kernel-export'],[driver,['verify'],'lexlean-verification'],
    [driver,['native'],'native-code-generation'],[driver,['wasm'],'wasm-code-generation'],
    [driver,['generate'],'native-code-generation'],[driver,['generate-wasm'],'wasm-code-generation'],
    ['cargo',['clean'],'artifact-cleanup'],['lake',['clean'],'artifact-cleanup'],['cargo',['run'],'unclassified-execution'],
    ['/private/runner',['native'],'unclassified-execution'],['lake',['unknown'],'unclassified-execution'],
    ['/private/runner',['private-payload'],'unclassified-execution'],
    ['/private/driver-execution',['verify'],'unclassified-execution'],
    ['/private/browser-workspace-view-driver',['verify'],'unclassified-execution'],
    ['/private/driver-target/debug/substituted-driver',['verify'],'unclassified-execution']];
  for(const [program,args,phase]of cases)assert.equal(compilerPhase(program,args),phase);
  for(const mode of ['guest','journal','partition','generate-journal-wasm','generate-probe-wasm',
    'labels','intent','secret','route','sink','maxroute','maxsink','maxfield','maxsecret','progress','maxprogress'])
    assert.equal(compilerPhase(driver,[mode]),'wasm-code-generation');
  assert.equal(compilerPhase(driver,['unknown-mode']),'unclassified-execution');
});
test('every current private compiler basename is observed without classifying arbitrary applications',()=>{
  const names=[];
  for(const directory of readdirSync(join(repository,'tests'))) {
    for(const subdirectory of ['driver','reservation-driver']) {
      let text;
      try{text=readFileSync(join(repository,'tests',directory,subdirectory,'Cargo.toml'),'utf8');}
      catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')continue;throw error;}
      const name=/^name = "([a-z0-9-]+)"$/m.exec(text)?.[1];assert(name);names.push(name);
    }
  }
  const model=readFileSync(join(repository,'sdk/browser/workspace-model-test.mjs'),'utf8');
  const name=/debug\/(browser-workspace-model-driver)/.exec(model)?.[1];assert(name);names.push(name);
  assert.equal(names.length,28);assert.equal(new Set(names).size,27);
  assert.equal(names.filter(name=>name==='browser-session-journal-driver').length,2);
  const originalNames=['browser-budget-driver','browser-workspace-command-driver','browser-custody-driver',
    'browser-effects-driver','browser-workspace-envelope-driver','browser-workspace-journal-driver',
    'browser-operation-journal-driver','browser-presentation-driver','browser-workspace-query-driver',
    'browser-workspace-view-driver','publication-admission-driver','browser-workspace-model-driver'];
  assert.equal(originalNames.length,12);assert.equal(new Set(originalNames).size,12);
  for(const name of originalNames)assert(names.includes(name),'original compiler owner remains registered: '+name);
  for(const name of names) {
    const driver='/private/driver-target/debug/'+name;
    assert.equal(compilerPhase(driver,['verify']),'lexlean-verification');
    assert.equal(compilerPhase('/private/'+name,['verify']),'unclassified-execution');
    assert.equal(compilerPhase(driver,['unknown-mode']),'unclassified-execution');
  }
});
test('all current generation modes retain raw and captured ownership with no basename-only admission',t=>{
  const work=mkdtempSync(join(tmpdir(),'prismpm-phase-driver-'));t.after(()=>rmSync(work,{recursive:true}));
  const original=join(work,'original');copyFileSync('/bin/true',original);chmodSync(original,0o700);
  const owner=captureCompilerArtifact(work,original,'driver');
  assert.equal(compilerPhase(owner.path,['verify']),'unclassified-execution');
  assert.equal(compilerPhase(owner.path,['verify'],{...owner}),'unclassified-execution');
  assert.equal(compilerPhase(original,['verify'],owner),'unclassified-execution');
  assert.equal(compilerPhase(owner.path,['verify'],owner),'lexlean-verification');
  for(const mode of ['guest','journal','partition','generate-journal-wasm','generate-probe-wasm',
    'predecessor','session','observation','descriptor','reservation','retention','layout','tail','parity',
    'context','recovery','metadata','signed-context','account-genesis','context-fields-wasm','admission-wasm',
    'wire','semantic','designs','predicates','catalogue']) {
    assert.equal(compilerPhase('/private/driver-target/debug/browser-workspace-view-driver',[mode]),'wasm-code-generation');
    assert.equal(compilerPhase(owner.path,[mode],owner),'wasm-code-generation');
  }
  assert.equal(compilerPhase(owner.path,['unknown-mode'],owner),'unclassified-execution');
});
test('arbitrary chunks and interleaved files preserve exact numeric totals',()=>{
  const c=phaseCollector(),a=encoded(row()),b=encoded(row('kernel-export',8,false));
  for(let i=0;i<a.length;i++){c.accept('/private/a',a[i]);if(i<b.length)c.accept('/private/b',b[i]);}
  for(let i=a.length;i<b.length;i++)c.accept('/private/b',b[i]);
  assert.deepEqual(c.summary(),{scope:'compiler-phase-diagnostic-not-acceptance',
    phases:[{phase:'kernel-export',calls:2,failures:1,elapsed_ms:20}]});
  assert(!JSON.stringify(c.summary()).includes('/private'));
});
test('malformed, unbounded and open diagnostics cannot be echoed or counted',()=>{
  const c=phaseCollector();
  for(const bad of [null,{},row('private-path'),row('kernel-export',-1),row('kernel-export',1.5),
    row('kernel-export',600001),row('kernel-export',1,'yes'),{...row(),secret:'credential'},
    {...row(),elapsed_ms:null}])c.accept('a',encoded(bad));
  c.accept('a',prefix+'{malformed}\n'+encoded(row()).trimEnd());
  assert.deepEqual(c.summary().phases,[],'unterminated messages are not observations');
  c.accept('a','\n'+'x'.repeat(1000000)+'\n'+encoded(row('rust-compilation',0)));
  assert.deepEqual(c.summary().phases,[{phase:'kernel-export',calls:1,failures:0,elapsed_ms:12},
    {phase:'rust-compilation',calls:1,failures:0,elapsed_ms:0}]);
});
test('stream inventory is bounded and an oversized record cannot hide the next valid line',()=>{
  const c=phaseCollector();for(let i=0;i<64;i++)c.accept('file-'+i,'');
  c.accept('unregistered',encoded(row()));
  c.accept('file-0',prefix+' '.repeat(300)+JSON.stringify(row())+'\n'+encoded(row()));
  assert.equal(c.summary().phases[0].calls,1);
});
test('supplementary and fragmented surrogate characters cannot bypass the retained UTF-16 bound',()=>{
  for(const chunks of [['x'.repeat(255),'😀','x'.repeat(10000)],
    ['x'.repeat(255),'\ud83d','\ude00','x'.repeat(10000)]]){
    const c=phaseCollector();
    for(const chunk of chunks){c.accept('file',chunk);assert(c.bufferedCodeUnits()<=256);}
    assert.equal(c.bufferedCodeUnits(),0);
    c.accept('file','\n'+encoded(row()));assert.equal(c.summary().phases[0].calls,1);
  }
});
test('actual Node reporter preserves complete passing and failing test results',t=>{
  const directory=mkdtempSync(join(tmpdir(),'prismpm-phase-reporter-'));t.after(()=>rmSync(directory,{recursive:true}));
  const reporter='data:text/javascript;base64,'+readFileSync(new URL('./owning-node-reporter.mjs',import.meta.url)).toString('base64');
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  for(const fails of [false,true]){
    const file=join(directory,fails?'failure.mjs':'success.mjs');
    writeFileSync(file,`import test from 'node:test';import assert from 'node:assert/strict';test('actual fixture',()=>{process.stderr.write(${JSON.stringify(encoded(row()))});assert.equal(${fails},false);});`);
    const p=spawnSync(process.execPath,['--test','--test-reporter='+reporter,file],{env:environment,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
    assert.ifError(p.error);assert.equal(p.signal,null);assert.equal(p.status,fails?1:0);
    const lines=p.stdout.split('\n'),fileRows=lines.filter(line=>line.startsWith('# prismpm-owning-file '));
    assert.equal(fileRows.length,1);const completion=JSON.parse(fileRows[0].slice('# prismpm-owning-file '.length));
    assert.equal(completion.tests,1);assert.equal(completion.success,!fails);assert.equal(completion.failed,Number(fails));
    const summaries=lines.filter(line=>line.startsWith('# prismpm-compiler-phase-summary '));
    assert.equal(summaries.length,1);assert.deepEqual(JSON.parse(summaries[0].slice('# prismpm-compiler-phase-summary '.length)).phases,
      [{phase:'kernel-export',calls:1,failures:0,elapsed_ms:12}]);
  }
});
test('real SDK command timings and a closed diagnostic pipe preserve outcomes',async()=>{
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const program=`import assert from 'node:assert/strict';
    import {run,repository} from ${JSON.stringify(new URL('../tests/browser-view/compile.mjs',import.meta.url).href)};
    function execute(){
      assert.equal(run('node',['-e','process.stdout.write("phase-positive")'],repository),'phase-positive');
      assert.throws(()=>run('node',['-e','process.stdout.write("phase-negative");process.exit(7)'],repository),
        error=>error.code==='ERR_ASSERTION'&&error.actual===7&&error.expected===0);
    }
    execute();process.stderr.write('PHASE_PIPE_READY\\n');
    await new Promise(resolve=>process.stdin.once('data',resolve));
    execute();process.stdout.write('actual-outcomes-preserved');`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{env:environment,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',closed=false;
  child.stdout.on('data',bytes=>{stdout+=bytes;assert(stdout.length<=1024*1024);});
  child.stderr.on('data',bytes=>{
    stderr+=bytes;assert(stderr.length<=1024*1024);
    if(!closed&&stderr.includes('PHASE_PIPE_READY\n')){closed=true;child.stderr.destroy();child.stdin.end('continue');}
  });
  const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);
  let outcome;
  try{outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>resolve({status,signal}));});}
  finally{clearTimeout(timeout);}
  assert.equal(outcome.signal,null);assert.equal(outcome.status,0,stderr);assert(closed);
  assert.equal(stdout,'actual-outcomes-preserved');
  const records=stderr.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
  assert.deepEqual(records.filter(row=>row.phase==='unclassified-execution').map(row=>row.success),[true,false]);
  assert(records.every(row=>Number.isSafeInteger(row.elapsed_ms)&&row.elapsed_ms>=0));
  assert(!stderr.includes('phase-positive')&&!stderr.includes('phase-negative'));
});
