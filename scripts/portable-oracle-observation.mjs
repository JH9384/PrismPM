// Source-owned qualification of diagnostic noninterference, never application
// implementation or an alternative response/body acceptance path.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {capture} from './portable-oracle-custody.mjs';
import {submissionDiagnosticSummary} from './portable-oracle-diagnostics.mjs';

const schema='prismpm/portable-observation-witness/1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const replacement=(source,point,value)=>{
 assert.equal(source.split(point).length,2,'diagnostic qualification point must be unique');
 return source.replace(point,value);
};
export function expectedObservationSubmissions(profile,trigger){
 assert(['legacy-numeric','utf8-text'].includes(profile.profile));
 assert(['click','keyboard'].includes(trigger));
 const recovery=profile.vector_indexes[0];assert(Number.isInteger(recovery));
 const row=(journey,vectorIndex=recovery,keyboard=false)=>({journey,vectorIndex,keyboard});
 const expected=profile.vector_indexes.map(index=>row('modeled-vectors',index,trigger==='keyboard'));
 expected.push(row('modeled-vectors',recovery,true),row('input-validation-recovery'),
  row('transport-failure-recovery'),row('delayed-init',recovery,trigger==='keyboard'),row('intent-boundaries'));
 if(profile.profile==='utf8-text'){
  for(let index=0;index<4;index++)expected.push(row('text-response-bounds'));
  expected.push(row('text-safe-rendering'));
 }
 return expected.map((row,index)=>({submission:index+1,...row}));
}
// Raw dispatch-to-render samples (#392) vary on every real run; they are a
// measurement, not acceptance. Compare the oracle report without them.
export function acceptanceReport(report){
 const {browser_timing:_timing,...portable}=report?.portable_browser??{};
 return report?.portable_browser===undefined?report:{...report,portable_browser:portable};
}
export function observationSummary(value){
 const integer=(number,maximum)=>Number.isSafeInteger(number)&&number>=0&&number<=maximum?number:null;
 const digest=number=>typeof number==='string'&&/^[a-f0-9]{64}$/.test(number)?number:null;
 const journeys=new Set(['modeled-vectors','input-validation-recovery','transport-failure-recovery',
  'delayed-init','intent-boundaries','text-response-bounds','text-safe-rendering']);
 const phases=new Set(['initial-readiness','fill','submission','response-body','rendered-result','completed-readiness','completed']);
 const submissionFailures=Array.isArray(value?.submission_failures)?value.submission_failures:[];
 const cleanupFailures=Array.isArray(value?.cleanup_failures)?value.cleanup_failures:[];
 return {schema:'prismpm/portable-observation-diagnostic/1',scope:'diagnostics-only-not-acceptance',
  status:value?.status==='passed'?'passed':'incomplete',exit_code:integer(value?.exit_code,255),
  terminated:value?.terminated===true,execution_error:value?.execution_error===true,
  driver_sha256:digest(value?.driver_sha256),stdout_sha256:digest(value?.stdout_sha256),stderr_sha256:digest(value?.stderr_sha256),
  witnesses:(Array.isArray(value?.witnesses)?value.witnesses:[]).slice(0,128).map(row=>({
   submission:integer(row?.submission,128),journey:journeys.has(row?.journey)?row.journey:'other',vectorIndex:integer(row?.vectorIndex,65536),
   keyboard:typeof row?.keyboard==='boolean'?row.keyboard:null,phase:phases.has(row?.phase)?row.phase:'other',
   network:row?.network?.state==='observed'?{state:'observed',requests:integer(row.network.requests,32),overflow:row.network.overflow===true}:{state:'unavailable'},
   requests:integer(row?.requests,32),responses:integer(row?.responses,32),completions:integer(row?.completions,32),
   failures:integer(row?.failures,32),eventsTruncated:row?.eventsTruncated===true})),
  witnesses_truncated:value?.witnesses_truncated===true||(Array.isArray(value?.witnesses)&&value.witnesses.length>128),
  submission_failures:submissionFailures.slice(0,4).map(row=>submissionDiagnosticSummary(row,'summary')),
  submission_failures_truncated:value?.submission_failures_truncated===true||submissionFailures.length>4,
  cleanup_failures:cleanupFailures.slice(0,2).map(row=>({
   resource:['browser','stdin'].includes(row?.resource)?row.resource:'other',
   failure:['assertion','timeout','unexpected','response-body-failed','response-body-unavailable'].includes(row?.failure)?row.failure:'other'})),
  cleanup_failures_truncated:value?.cleanup_failures_truncated===true||cleanupFailures.length>2};
}
export function observationFailureDiagnostics(stderr){
 const submission_failures=[],cleanup_failures=[];
 let submission_failures_truncated=false,cleanup_failures_truncated=false;
 for(const line of (stderr??'').split('\n')){
  let row;try{row=JSON.parse(line);}catch{continue;}
  if(['prismpm/browser-submission-diagnostic/1','prismpm/browser-submission-diagnostic/2'].includes(row?.schema)){
   if(submission_failures.length<4)submission_failures.push(submissionDiagnosticSummary(row));
   else submission_failures_truncated=true;
  }else if(row?.schema==='prismpm/browser-cleanup-diagnostic/1'){
   if(cleanup_failures.length<2)cleanup_failures.push({resource:row.resource,failure:row.failure});
   else cleanup_failures_truncated=true;
  }
 }
 return observationSummary({submission_failures,cleanup_failures,submission_failures_truncated,cleanup_failures_truncated});
}
export function observationDriver(source,mode,trigger){
 assert(['observed','unobserved','ordinary'].includes(mode),'closed observation mode required');
 assert(['click','keyboard'].includes(trigger),'closed observation trigger required');
 let driver=source;
 const entry='async function submit(vector, target = page, keyboard = false, {fillInputs = true} = {}) {';
 driver=replacement(driver,entry,`let observationOrdinal = 0;\n${entry}\n  const observationSubmission = ++observationOrdinal;`);
 const acquisition='    network = await submissionNetworkOwner(target, `${origin}/_hologram/intent`, expectedRequest, record, diagnosticCleanup);';
 driver=replacement(driver,acquisition,mode==='observed'
  ? acquisition+'\n    await network.ready; // Diagnostic-only witness preparation, not ordinary acceptance.'
  : mode==='ordinary' ? acquisition : '    // Qualification omits only the read-only diagnostic collector.');
 if(trigger==='keyboard'){
  driver=replacement(driver,'      await submit(vector);','      await submit(vector, page, true);');
  driver=replacement(driver,'    await submit(recovery, delayedPage, false, {fillInputs: false});',
   '    await submit(recovery, delayedPage, true, {fillInputs: false});');
 }
 return replacement(driver,'    network.retire();',
  `    emitDiagnostic({schema: '${schema}', submission: observationSubmission, phase, journey: activeJourney, vectorIndex: app.acceptance_vectors.indexOf(vector), keyboard, network: network.summary(),
      requests: events.filter(row => row.event === 'cdp-request' && row.method === 'POST' && row.payloadMatches === true).length,
      responses: events.filter(row => row.event === 'cdp-response' && row.status === 200).length,
      completions: events.filter(row => row.event === 'cdp-finished').length,
      failures: events.filter(row => row.event === 'cdp-failed').length, eventsTruncated});
    network.retire();${mode==='observed' ? '\n    await network.stop(); // Mandatory diagnostic qualification owns this join.' : ''}`);
}
export function requireObservationWitnesses(rows,mode,expected){
 assert(['observed','unobserved','ordinary'].includes(mode));
 assert(expected.length>0&&expected.length<=128,'complete bounded expected submission inventory required');
 assert.deepEqual(rows.map(({submission,journey,vectorIndex,keyboard})=>({submission,journey,vectorIndex,keyboard})),expected,
  'every expected real submission must have its own ordered witness');
 for(const row of rows){
  assert.deepEqual(Object.keys(row).sort(),['schema','submission','phase','journey','vectorIndex','keyboard','network','requests','responses','completions','failures','eventsTruncated'].sort());
  assert.equal(row.schema,schema);assert.equal(row.phase,'completed-readiness');
  assert.equal(typeof row.keyboard,'boolean');assert.equal(row.eventsTruncated,false);
  assert.equal(row.failures,0);
  if(mode==='observed'){
   assert.deepEqual(row.network,{state:'observed',requests:1,overflow:false});
   assert.equal(row.requests,1);assert.equal(row.responses,1);assert.equal(row.completions,1);
  }else if(mode==='unobserved'||row.network.state==='unavailable'){
   assert.deepEqual(row.network,{state:'unavailable'});
   assert.equal(row.requests,0);assert.equal(row.responses,0);assert.equal(row.completions,0);
  }else{
   assert.deepEqual(Object.keys(row.network).sort(),['overflow','requests','state']);
   assert.equal(row.network.state,'observed');assert.equal(row.network.overflow,false);
   for(const count of [row.network.requests,row.requests,row.responses,row.completions])
    assert(Number.isSafeInteger(count)&&count>=0&&count<=1,'ordinary diagnostics cannot invent or duplicate requests');
   assert.equal(row.requests,row.network.requests);
   assert(row.responses<=row.requests&&row.completions<=row.requests,'only a correlated observed request may contribute events');
  }
 }
 if(mode==='ordinary')assert(rows.some(row=>row.network.state==='observed'&&row.requests===1),
  'ordinary scheduling qualification must exercise an actual correlated diagnostic observation');
}
function main(){
 const [oracle,artifact,browser,mode,trigger,evidence,...extra]=process.argv.slice(2);
 assert.equal(extra.length,0);assert(oracle&&artifact&&browser&&evidence);
 assert(['observed','unobserved','ordinary'].includes(mode));assert(['click','keyboard'].includes(trigger));
 const root=fileURLToPath(new URL('../',import.meta.url));
 const sourcePath=join(root,'crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const source=readFileSync(sourcePath,'utf8'),matrixPath=join(root,'tests/data/portable-oracle-matrix.json');
 const modelPath=join(resolve(artifact),'model.prism.json'),model=JSON.parse(readFileSync(modelPath));
 const matrix=JSON.parse(readFileSync(matrixPath));
 const profile=matrix.profiles.find(row=>row.name===model.application.name);assert(profile);
 const archive=join(resolve(artifact),profile.name+'.holo');
 const wasm=join(resolve(artifact),'core-wasm',profile.cargo_name.replaceAll('-','_')+'_core_wasm.wasm');
 const subjects=[sourcePath,matrixPath,oracle,modelPath,archive,wasm,process.execPath,browser].map(capture);
 const directory=resolve(evidence);mkdirSync(directory);
 const driver=join(directory,'driver.mjs');writeFileSync(driver,observationDriver(source,mode,trigger),{flag:'wx'});
 const driverSubject=capture(driver);subjects.push(driverSubject);
 const result=spawnSync(resolve(oracle),[archive,modelPath,wasm,driver,process.execPath,resolve(browser)],
  {timeout:120000,maxBuffer:1048576,encoding:'utf8'});
 for(const stream of ['stdout','stderr'])writeFileSync(join(directory,stream+'.txt'),result[stream]??'',{flag:'wx'});
 const rows=(result.stderr??'').split('\n').filter(Boolean).flatMap(line=>{
  try{const row=JSON.parse(line);return row?.schema===schema?[row]:[];}catch{return [];}
 });
 const failures=observationFailureDiagnostics(result.stderr);
 const preliminary={schema:'prismpm/portable-observation-result/1',scope:'diagnostic-noninterference-qualification',
  mode,trigger,profile:profile.profile,witnesses:rows,status:'incomplete',exit_code:result.status,
  submission_failures:failures.submission_failures,submission_failures_truncated:failures.submission_failures_truncated,
  cleanup_failures:failures.cleanup_failures,cleanup_failures_truncated:failures.cleanup_failures_truncated,
  terminated:result.signal!==null,execution_error:!!result.error,driver_sha256:driverSubject.measurement.sha256,
  stdout_sha256:hash(result.stdout??''),stderr_sha256:hash(result.stderr??'')};
 // Closed failure witnesses survive even if the real session or any subsequent
 // assertion fails. Their existence never establishes application acceptance.
 writeFileSync(join(directory,'result.json'),JSON.stringify({...preliminary,
  witnesses:observationSummary(preliminary).witnesses})+'\n',{flag:'wx'});
 for(const subject of subjects)subject.verify();
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,'real upstream session must pass without retry');
 const report=JSON.parse(result.stdout.trim());assert.equal(report.schema,'prismpm/hologram-oracle/2');
 const actual=report.portable_browser;
 assert.equal(actual.schema,'prismpm/portable-browser-oracle/1');assert.equal(actual.status,'passed');
 assert.equal(actual.skipped,0);assert.equal(actual.retries,0);assert.equal(actual.profile,profile.profile);
 assert.equal(actual.browser_version,'157.0.8099.0');assert.equal(actual.playwright,'1.62.1');
 assert.deepEqual(actual.vector_indexes,profile.vector_indexes);
 assert.deepEqual(actual.cases,profile.journeys.map(name=>({name,status:'passed',attempts:1})));
 requireObservationWitnesses(rows,mode,expectedObservationSubmissions(profile,trigger));
 const value={...preliminary,submissions:rows.length,keyboard_submissions:rows.filter(row=>row.keyboard).length,
  report,report_sha256:hash(result.stdout),driver_sha256:driverSubject.measurement.sha256,
  subjects:subjects.map(row=>row.measurement),status:'passed'};
 assert(value.keyboard_submissions>0,'full original keyboard recovery remains required');
 writeFileSync(join(directory,'result.json'),JSON.stringify(value)+'\n');
 console.log(JSON.stringify(value));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
