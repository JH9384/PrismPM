import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync, existsSync, realpathSync, chmodSync, linkSync, symlinkSync, copyFileSync} from 'node:fs';
import * as actualFs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname as actualDirname,resolve as actualResolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {capture, requireBoundaryCheck, refuseCargoAncestorConfiguration, snapshotSourceTree, privateGitObjects, privateRegistryDownloads, applyNegativeControl, reportChildFailure} from './portable-oracle-custody.mjs';
import {PortableDiagnosticBundle,diagnosticLimits,readDiagnosticFile,probeSummary,retainDiagnostic} from './portable-oracle-diagnostics.mjs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {observationDriver,requireObservationWitnesses,expectedObservationSubmissions,observationSummary,observationFailureDiagnostics} from './portable-oracle-observation.mjs';
import {retirementFaults,retirementDriver,retirementSummary,requirePrimaryBodyFault,requireAcquisitionRefusal} from './portable-oracle-retirement.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const matrix = JSON.parse(read('tests/data/portable-oracle-matrix.json'));

const diagnosticRoot=t=>{const root=mkdtempSync(join(tmpdir(),'portable-diagnostic-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
const hash=value=>createHash('sha256').update(value).digest('hex');
test('live observation qualification transforms only diagnostics and retains all original acceptance predicates',()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const call='    network = await submissionNetworkOwner(target, `${origin}/_hologram/intent`, expectedRequest, record, diagnosticCleanup);';
 for(const mode of ['observed','unobserved'])for(const trigger of ['click','keyboard']){
  const driver=observationDriver(source,mode,trigger);
  assert.equal(driver.includes(call),mode==='observed');
  assert.equal(driver.includes('await network.ready;'),mode==='observed');
  assert.equal(source.includes('await network.ready;'),false,'ordinary acceptance cannot join diagnostic setup');
  for(const point of ['try { replyBody = await bounded(reply.body()); }',
   'assert.equal(invocationCount, 1', 'assert.equal(navigated, false',
   'assert.deepEqual(envelope,', 'await target.waitForFunction(ready)', 'await shows(displayed(vector), target)'])
   assert.equal(driver.split(point).length,source.split(point).length);
  for(const profile of matrix.profiles)for(const journey of profile.journeys)
   assert(driver.includes(`await journey('${journey}'`));
  assert.equal(driver.split('network.retire();').length,source.split('network.retire();').length);
  assert.equal(driver.includes('await network.stop();'),mode==='observed');
  assert.equal(source.includes('await network.stop();'),false,'ordinary acceptance cannot join optional detach');
  assert.equal(driver.includes('await submit(vector, page, true);'),trigger==='keyboard');
 }
 assert.throws(()=>observationDriver(source,'unknown','click'));
 assert.throws(()=>observationDriver(source,'observed','unknown'));
 assert.throws(()=>observationDriver(source+call,'unobserved','click'));
 const owner=read('scripts/portable-oracle-matrix.mjs');
 assert(owner.includes("'scripts/portable-oracle-observation.mjs'"));
 assert(owner.includes("assert.equal(observationPairs.length, 4"));
 assert(owner.includes('assert.deepEqual(pair[0].report, pair[1].report'));
 assert(owner.includes('assert.equal(outcomes.length, 78'));
 assert(owner.includes('assert.equal(negativeControls.length, 4'));
 assert.equal(retirementFaults.length,13);assert.equal(new Set(retirementFaults).size,13);
 for(const fault of retirementFaults)for(const trigger of ['click','keyboard']){
  const driver=retirementDriver(source,fault,trigger);
  for(const point of ['assert.equal(invocationCount, 1','assert.equal(navigated, false',
   'assert.deepEqual(envelope,','await target.waitForFunction(ready)','await shows(displayed(vector), target)'])
   assert.equal(driver.split(point).length,source.split(point).length);
  for(const profile of matrix.profiles)for(const journey of profile.journeys)assert(driver.includes(`await journey('${journey}'`));
  assert.equal(driver.includes('await submit(vector, page, true);'),trigger==='keyboard');
  assert.equal(driver.includes('await network.stop();'),false,'whole-profile faults must exercise ordinary nonjoining retirement');
  assert(driver.includes('10_000'),'original operation bound remains unchanged');
 }
 assert.throws(()=>retirementDriver(source,'unknown','click'));assert.throws(()=>retirementDriver(source,'pending-detach','unknown'));
 assert(owner.includes("'scripts/portable-oracle-retirement.mjs'"));assert(owner.includes('assert.equal(retirementOutcomes.length,32'));
 assert(owner.includes('retirement_controls:retirementOutcomes'));
 const faults=read('scripts/portable-oracle-retirement.mjs');
 for(const guard of ['witness.retired_listeners, 0','witness.close_held, fault',
  'witness.handoffs,witness.acquisitions','witness.enables,0', 'witness.peak_detaches<=expected',
  'witness.elapsed_ms < 120_000','witness.cleanup_elapsed_ms < 12_000'])assert(faults.includes(guard));
 const summary=retirementSummary({fault:'private-control',witness:{acquisitions:129,detaches:1,enables:0,elapsed_ms:120001,secret:'private-data'},secret:'private-data'});
 assert.equal(summary.fault,null);assert.equal(summary.witness.acquisitions,null);assert.equal(summary.witness.elapsed_ms,null);
 assert(!JSON.stringify(summary).includes('private-'));
 const bodyDriver=retirementDriver(source,'primary-body-failure','click');
 assert(bodyDriver.includes('await target.close(); retirementTargetClosed = target.isClosed();\n      try { retirementBodyInvocations++; replyBody = await bounded(reply.body()); }'));
 assert(!bodyDriver.includes('try { await target.close();'));
 const bodyWitness={primary_failure:true,cleanup_failure:true,acquisitions:1,detaches:1,target_closed:true,body_invocations:1};
 const bodyFailures={submission_failures:[{failure:'response-body-failed'}],cleanup_failures:[{failure:'unexpected'}]};
 const bodyError='portable View oracle response-body-failed';
 assert.doesNotThrow(()=>requirePrimaryBodyFault(bodyWitness,bodyFailures,bodyError));
 for(const patch of [{target_closed:false},{body_invocations:0},{body_invocations:2},{primary_failure:false}])
  assert.throws(()=>requirePrimaryBodyFault({...bodyWitness,...patch},bodyFailures,bodyError));
 assert.throws(()=>requirePrimaryBodyFault(bodyWitness,{...bodyFailures,submission_failures:[{failure:'unexpected'}]},bodyError));
 const refusal={prepared_acquisitions:2,acquisition_invocations:2,acquisition_refusals:2,acquisitions:0,enables:0};
 assert.doesNotThrow(()=>requireAcquisitionRefusal(refusal,2));
 for(const patch of [{prepared_acquisitions:0},{prepared_acquisitions:1},{acquisition_invocations:0},
  {acquisition_invocations:1},{acquisition_refusals:0},{acquisitions:1},{enables:1}])
  assert.throws(()=>requireAcquisitionRefusal({...refusal,...patch},2));
 const closedFailures=retirementSummary({fault:'primary-body-failure',exit_code:1,terminated:true,execution_error:true,
  submission_failures:[{failure:'response-body-failed',phase:'response-body',secret:'private-value'}],
  cleanup_failures:[{resource:'browser',failure:'unexpected',secret:'private-value'}],
  submission_failures_truncated:true,cleanup_failures_truncated:true});
 assert.equal(closedFailures.exit_code,1);assert.equal(closedFailures.terminated,true);assert.equal(closedFailures.execution_error,true);
 assert.equal(closedFailures.submission_failures[0].failure,'response-body-failed');
 assert.equal(closedFailures.cleanup_failures[0].failure,'unexpected');
 assert.equal(closedFailures.submission_failures_truncated,true);assert.equal(closedFailures.cleanup_failures_truncated,true);
 assert(!JSON.stringify(closedFailures).includes('private-value'));
 assert.deepEqual(retirementSummary(closedFailures),closedFailures);
});
test('live CDP qualification rejects unavailable, omitted, incomplete and invented observation witnesses',()=>{
 const observed={schema:'prismpm/portable-observation-witness/1',submission:1,phase:'completed-readiness',journey:'modeled-vectors',vectorIndex:0,keyboard:true,
  network:{state:'observed',requests:1,overflow:false},requests:1,responses:1,completions:1,failures:0,eventsTruncated:false};
 const unobserved={...observed,network:{state:'unavailable'},requests:0,responses:0,completions:0};
 const expected=[{submission:1,journey:'modeled-vectors',vectorIndex:0,keyboard:true}];
 assert.doesNotThrow(()=>requireObservationWitnesses([observed],'observed',expected));
 assert.doesNotThrow(()=>requireObservationWitnesses([unobserved],'unobserved',expected));
 assert.throws(()=>requireObservationWitnesses([],'observed',expected));
 assert.throws(()=>requireObservationWitnesses([unobserved],'observed',expected));
 assert.throws(()=>requireObservationWitnesses([observed],'unobserved',expected));
 for(const patch of [{requests:0},{responses:0},{completions:0},{failures:1},{eventsTruncated:true},
  {phase:'response-body'},{keyboard:'yes'},{privatePayload:'secret'},
  {network:{state:'observed',requests:2,overflow:false}}])
  assert.throws(()=>requireObservationWitnesses([{...observed,...patch}],'observed',expected));
 assert.throws(()=>requireObservationWitnesses(Array(129).fill(observed),'observed',expected));
 const source=read('scripts/portable-oracle-observation.mjs');
 for(const guard of ["assert.equal(result.status,0",'assert.equal(result.signal,null)',
  'subject.verify()', 'assert.deepEqual(actual.vector_indexes,profile.vector_indexes)',
  'assert.deepEqual(actual.cases,profile.journeys', 'requireObservationWitnesses(rows,mode,expectedObservationSubmissions'])assert(source.includes(guard));
});
test('observation qualification owns every ordered modeled submission and rejects matching omissions in both modes',()=>{
 for(const profile of matrix.profiles)for(const trigger of matrix.triggers){
  const expected=expectedObservationSubmissions(profile,trigger);
  assert.equal(expected.length,profile.profile==='utf8-text'?13:20);
  assert.equal(expected.filter(row=>row.keyboard).length,trigger==='click'?1:profile.profile==='utf8-text'?5:17);
  const observed=expected.map(row=>({...row,schema:'prismpm/portable-observation-witness/1',phase:'completed-readiness',
   network:{state:'observed',requests:1,overflow:false},requests:1,responses:1,completions:1,failures:0,eventsTruncated:false}));
  for(const mode of ['observed','unobserved']){
   const rows=mode==='observed'?observed:observed.map(row=>({...row,network:{state:'unavailable'},requests:0,responses:0,completions:0}));
   assert.doesNotThrow(()=>requireObservationWitnesses(rows,mode,expected));
   for(let index=0;index<rows.length;index++){
    assert.throws(()=>requireObservationWitnesses(rows.filter((_,selected)=>selected!==index),mode,expected));
    assert.throws(()=>requireObservationWitnesses([...rows.slice(0,index),rows[index],...rows.slice(index)],mode,expected));
    for(const patch of [{journey:'other'},{vectorIndex:65536},{keyboard:!rows[index].keyboard}])
     assert.throws(()=>requireObservationWitnesses(rows.map((row,selected)=>selected===index?{...row,...patch}:row),mode,expected));
   }
   if(profile.profile==='utf8-text'){
    const indices=rows.flatMap((row,index)=>row.journey==='text-response-bounds'?[index]:[]);
    assert.equal(indices.length,4);
    const identicalDuplicate=rows.slice();identicalDuplicate[indices[0]]=rows[indices[1]];
    assert.throws(()=>requireObservationWitnesses(identicalDuplicate,mode,expected),assert.AssertionError);
   }
  }
 }
});
test('observation failures retain only closed bounded witnesses and their executed driver before acceptance assertions',()=>{
 const summary=observationSummary({status:'private-text',driver_sha256:'a'.repeat(64),witnesses:[
  {journey:'private-journey',vectorIndex:'private-text',keyboard:true,phase:'private-phase',requests:-1,
   network:{state:'observed',requests:99,secret:'private-text'},payload:'private-text'}],report:{secret:'private-text'}});
 assert.equal(summary.status,'incomplete');assert.equal(summary.witnesses[0].journey,'other');
 assert.equal(summary.witnesses[0].requests,null);assert.equal(summary.witnesses[0].network.requests,null);
 assert(!JSON.stringify(summary).includes('private-text'));assert(!JSON.stringify(summary).includes('private-journey'));
 assert.equal(observationSummary({witnesses:Array(129).fill({})}).witnesses.length,128);
 assert.equal(observationSummary({witnesses:Array(129).fill({})}).witnesses_truncated,true);
 const source=read('scripts/portable-oracle-observation.mjs');
 assert(source.indexOf("writeFileSync(join(directory,'result.json')")<source.indexOf('assert.equal(result.status,0'));
 const owner=read('scripts/portable-oracle-matrix.mjs');
 assert(owner.includes('summary=observationSummary(JSON.parse(receiptBytes))'));
 const retention=owner.slice(owner.indexOf("if(/^[01]-observation-"));
 assert(retention.indexOf("diagnostics.file('cases/'")<retention.indexOf('readDiagnosticFile(receiptPath'));
 assert(retention.includes('assert.equal(expectedDriverHash,summary.driver_sha256)'));
 assert(source.indexOf('const driverSubject=capture(driver)')<source.indexOf('const result=spawnSync'));
 assert(source.includes('driver_sha256:driverSubject.measurement.sha256'));
});
test('observation receipts preserve submission and cleanup failure facts through repeated closed sanitization',()=>{
 const value={status:'incomplete',exit_code:1,witnesses:[{phase:'response-body'}],
  submission_failures:[{journey:'modeled-vectors',phase:'response-body',failure:'response-body-failed',
   check:'response-json',vector_index:2,invocation_count:1,keyboard:true,navigated:false,
   events_truncated:false,network:{state:'unavailable',secret:'private-value'},
   client:{state:'observed',responseError:true,secret:'private-value'},
   events:[{event:'request-failed',reason:'ERR_ABORTED',payload:'private-value'}],secret:'private-value'}],
  cleanup_failures:[{resource:'browser',failure:'timeout',secret:'private-value'}],
  submission_failures_truncated:true,cleanup_failures_truncated:true};
 const summary=observationSummary(value);
 assert.equal(summary.witnesses[0].phase,'response-body');
 assert.equal(summary.submission_failures[0].failure,'response-body-failed');
 assert.equal(summary.submission_failures[0].vector_index,2);
 assert.equal(summary.submission_failures[0].events[0].reason,'ERR_ABORTED');
 assert.deepEqual(summary.cleanup_failures,[{resource:'browser',failure:'timeout'}]);
 assert.equal(summary.submission_failures_truncated,true);assert.equal(summary.cleanup_failures_truncated,true);
 assert(!JSON.stringify(summary).includes('private-value'));
 assert.deepEqual(observationSummary(summary),summary,'uploaded receipt must not lose facts on its second sanitizer pass');
 const bounded=observationSummary({...value,submission_failures:Array(5).fill(value.submission_failures[0]),
  cleanup_failures:Array(3).fill({resource:'private-value',failure:'private-value'})});
 assert.equal(bounded.submission_failures.length,4);assert.equal(bounded.cleanup_failures.length,2);
 assert.deepEqual(bounded.cleanup_failures[0],{resource:'other',failure:'other'});
 const source=read('scripts/portable-oracle-observation.mjs');
 assert(source.includes('observationFailureDiagnostics(result.stderr'));
 assert(source.indexOf('observationFailureDiagnostics(result.stderr')<source.indexOf('assert.equal(result.status,0'));
});
test('observation stderr collection distinguishes closed failure schemas, bounds both inventories and excludes private text',()=>{
 const submission={schema:'prismpm/browser-submission-diagnostic/2',journey:'modeled-vectors',
  phase:'submission',failure:'timeout',vectorIndex:2,invocationCount:0,keyboard:true,
  network:{state:'unavailable'},events:[null,{event:'request-failed',reason:'ERR_ABORTED',secret:'private-value'}],
  client:{state:'unavailable'},secret:'private-value'};
 const cleanup={schema:'prismpm/browser-cleanup-diagnostic/1',resource:'stdin',failure:'unexpected',secret:'private-value'};
 const stderr=['private-value','null',JSON.stringify({schema:'private-value'}),
  ...Array(5).fill(JSON.stringify(submission)),...Array(3).fill(JSON.stringify(cleanup))].join('\n');
 const summary=observationFailureDiagnostics(stderr);
 assert.equal(summary.status,'incomplete');assert.equal(summary.submission_failures.length,4);
 assert.equal(summary.submission_failures_truncated,true);assert.equal(summary.cleanup_failures.length,2);
 assert.equal(summary.cleanup_failures_truncated,true);assert.equal(summary.submission_failures[0].phase,'submission');
 assert.equal(summary.submission_failures[0].vector_index,2);assert.equal(summary.submission_failures[0].events[1].reason,'ERR_ABORTED');
 assert.deepEqual(summary.cleanup_failures[0],{resource:'stdin',failure:'unexpected'});
 assert(!JSON.stringify(summary).includes('private-value'));
 assert.deepEqual(observationSummary(summary),summary);
 const v1=observationFailureDiagnostics(JSON.stringify({...submission,schema:'prismpm/browser-submission-diagnostic/1'}));
 assert(!Object.hasOwn(v1.submission_failures[0],'network'));
 assert(!Object.hasOwn(v1.submission_failures[0].events[1],'request'));
});
test('actual failure receipt construction retains collected facts and rejects either omitted assignment',t=>{
 // White-box failure wiring: this child is a negative fixture, not a product oracle.
 const source=read('scripts/portable-oracle-observation.mjs');
 const start=source.indexOf(' const rows=(result.stderr'),end=source.indexOf(' for(const subject of subjects)subject.verify();',start);
 assert(start>=0&&end>start);const block=source.slice(start,end);
 const submission={schema:'prismpm/browser-submission-diagnostic/2',phase:'response-body',failure:'response-body-failed',
  vectorIndex:2,keyboard:true,network:{state:'unavailable'},events:[],secret:'private-value'};
 const cleanup={schema:'prismpm/browser-cleanup-diagnostic/1',resource:'browser',failure:'timeout',secret:'private-value'};
 const stderr=JSON.stringify(submission)+'\n'+JSON.stringify(cleanup)+'\n';
 const result=spawnSync(process.execPath,['-e',`process.stderr.write(${JSON.stringify(stderr)});process.exit(17);`],
  {encoding:'utf8',timeout:1000,maxBuffer:1048576});
 assert.equal(result.status,17);assert.ifError(result.error);assert.equal(result.signal,null);
 const root=diagnosticRoot(t);
 const execute=body=>{
  const directory=mkdtempSync(join(root,'receipt-'));
  runInNewContext(body,{result,mode:'unobserved',trigger:'keyboard',profile:{profile:'utf8-text'},schema:'prismpm/portable-observation-witness/1',
   directory,driverSubject:{measurement:{sha256:'a'.repeat(64)}},observationSummary,observationFailureDiagnostics,hash,writeFileSync,join,JSON});
  const receipt=JSON.parse(readFileSync(join(directory,'result.json')));
  assert.equal(receipt.schema,'prismpm/portable-observation-result/1');assert.equal(receipt.status,'incomplete');assert.equal(receipt.exit_code,17);
  assert.equal(receipt.submission_failures[0].failure,'response-body-failed');assert.equal(receipt.submission_failures[0].vector_index,2);
  assert.deepEqual(receipt.cleanup_failures,[{resource:'browser',failure:'timeout'}]);assert(!JSON.stringify(receipt).includes('private-value'));
 };
 execute(block);
 for(const line of [
  '  submission_failures:failures.submission_failures,submission_failures_truncated:failures.submission_failures_truncated,\n',
  '  cleanup_failures:failures.cleanup_failures,cleanup_failures_truncated:failures.cleanup_failures_truncated,\n']){
  assert.equal(block.split(line).length,2);assert.throws(()=>execute(block.replace(line,'')));
 }
});
test('actual observation bundle retention copies executed drivers and closed failure receipts even when a receipt is missing',t=>{
 const source=read('scripts/portable-oracle-matrix.mjs');
 const start=source.indexOf('  if(/^[01]-observation-'),end=source.indexOf('  // Cleanup uncertainty',start);
 assert(start>=0&&end>start);const branch=source.slice(start,end);
 for(const kind of ['observation','retirement'])for(const state of ['receipt','missing','changed']){
  const missing=state==='missing',changed=state==='changed';
  const root=diagnosticRoot(t),evidence=join(root,'evidence'),name=kind==='observation'
   ?'0-observation-keyboard-observed':'0-retirement-click-primary-body-failure';
  mkdirSync(join(evidence,name),{recursive:true});
  const original=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
  const driver=kind==='observation'?observationDriver(original,'observed','keyboard'):retirementDriver(original,'primary-body-failure','click');
  writeFileSync(join(evidence,name,'driver.mjs'),driver+(changed?'\n// changed after execution':''));
  if(!missing)writeFileSync(join(evidence,name,'result.json'),JSON.stringify({status:'incomplete',driver_sha256:hash(driver),
   witnesses:[{journey:'private-journey',payload:'private-value'}],stderr:'private-value',
   submission_failures:[{phase:'response-body',failure:'response-body-failed',vector_index:2,keyboard:true}],
   cleanup_failures:[{resource:'browser',failure:'timeout'}]}));
  const diagnostics=new PortableDiagnosticBundle(root);
  runInNewContext(branch,{name,evidence,result:{status:1},expectedStatus:0,expectedDriverHash:hash(driver),diagnostics,retainDiagnostic,
   retirement:name.match(/^[01]-retirement-(click|keyboard)-([a-z-]+)$/),
   join,createHash,readDiagnosticFile,observationSummary,retirementSummary,assert,JSON,Number});
  const index=JSON.parse(readFileSync(join(diagnostics.path,'index.json')));
  if(changed){assert.deepEqual(index.files,[]);assert.equal(index.state,'incomplete');continue;}
  assert(index.files.some(row=>row.path==='cases/'+name+'.driver.mjs'&&row.sha256===hash(driver)));
  if(missing)assert.equal(index.state,'incomplete');
  else{
   const receipt=readFileSync(join(diagnostics.path,'cases/'+name+'.json'),'utf8');
   assert(!receipt.includes('private-value'));assert(!receipt.includes('private-journey'));
   assert.equal(JSON.parse(receipt).actual_exit_code,1);
   assert.equal(JSON.parse(receipt).submission_failures[0].failure,'response-body-failed');
   assert.equal(JSON.parse(receipt).submission_failures[0].vector_index,2);
   assert.deepEqual(JSON.parse(receipt).cleanup_failures,[{resource:'browser',failure:'timeout'}]);
  }
 }
});
function networkObserver(session, expected, events, source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs')) {
 const start=source.indexOf('function submissionNetworkRecorder('),end=source.indexOf('\nasync function submissionNetworkOwner(',start);
 const reasonStart=source.indexOf('function requestFailureReason('),reasonEnd=source.indexOf('\nfunction failureKind(',reasonStart);
 assert(start>=0&&end>start&&reasonStart>=0&&reasonEnd>reasonStart);
 const factory=runInNewContext('('+source.slice(start,end)+')',
  {assert,JSON,requestFailureReason:runInNewContext('('+source.slice(reasonStart,reasonEnd)+')')});
 return factory(session,'http://127.0.0.1:38129/_hologram/intent',expected,event=>{if(events.length<32)events.push(JSON.parse(JSON.stringify(event)));});
}
function networkOwner(target, events, bounded=operation=>operation,
 source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs'),registry) {
 const start=source.indexOf('async function submissionNetworkOwner('),end=source.indexOf('\nlet browser;',start);
 const registryStart=source.indexOf('function diagnosticRetirementRegistry('),registryEnd=source.indexOf('\n// CDP observations',registryStart);
 assert(start>=0&&end>start);
 const factory=runInNewContext('('+source.slice(start,end)+')',{bounded,
  diagnosticRetirementRegistry:runInNewContext('('+source.slice(registryStart,registryEnd)+')',{bounded}),
  submissionNetworkRecorder:(session,endpoint,expected,record)=>{
   assert.equal(endpoint,'http://127.0.0.1:38129/_hologram/intent');
   return networkObserver(session,expected,events,source);
  }});
 return factory(target,'http://127.0.0.1:38129/_hologram/intent',{expected:true},()=>{},registry);
}
test('actual CDP owner orchestration enables only default observation and retires exactly its own session',async()=>{
 const session=new EventEmitter(),commands=[],events=[];let detached=0;
 session.send=async(...args)=>{commands.push(args);};session.detach=async()=>{detached++;};
 const target={context:()=>({newCDPSession:async actual=>{assert.equal(actual,target);return session;}})};
 const owner=await networkOwner(target,events);await owner.ready;assert.deepEqual(commands,[['Network.enable']]);
 assert.equal(owner.summary().state,'observed');await owner.stop();await owner.stop();
 assert.equal(detached,1);assert.deepEqual(session.eventNames(),[]);
 const pendingSession=new EventEmitter();let releaseDetach,retired=false,pendingDetaches=0;
 pendingSession.send=async()=>{};
 pendingSession.detach=()=>{pendingDetaches++;return new Promise(resolve=>{releaseDetach=resolve;});};
 const pendingOwner=await networkOwner({context:()=>({newCDPSession:async()=>pendingSession})},[]);
 await pendingOwner.ready;
 // Exercise the real owner with a withheld diagnostic completion. Older
 // stop-only ownership serializes this optional wait into ordinary acceptance.
 const retiring=Promise.resolve(pendingOwner.retire ? pendingOwner.retire() : pendingOwner.stop())
  .then(()=>{retired=true;});
 try {
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(retired,true,'ordinary retirement must not await optional diagnostic detachment');
  assert.equal(pendingDetaches,1);assert.deepEqual(pendingSession.eventNames(),[]);
 } finally {releaseDetach();await retiring;await pendingOwner.stop();}
 let resolveLate,nonblocking;
 const lateArrival=new Promise(resolve=>{resolveLate=resolve;}),lateSession=new EventEmitter(),lateCommands=[];
 let lateDetached=0;lateSession.send=async(...args)=>{lateCommands.push(args);};lateSession.detach=async()=>{lateDetached++;};
 const acquiring=networkOwner({context:()=>({newCDPSession:()=>lateArrival})},[]);
 void acquiring.then(value=>{nonblocking=value;});await new Promise(resolve=>setImmediate(resolve));
 try {
  assert.ok(nonblocking,'diagnostic acquisition must not delay ordinary submission');
  assert.equal(typeof nonblocking.ready?.then,'function');assert.equal(nonblocking.summary().state,'unavailable');
  nonblocking.retire();assert.equal(lateDetached,0);
  resolveLate(lateSession);await nonblocking.ready;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lateDetached,1);assert.deepEqual(lateCommands,[]);assert.deepEqual(lateSession.eventNames(),[]);
 } finally {resolveLate(lateSession);await (await acquiring).stop();}
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const postArrivalRetirement=async body=>{
  let resume;const resumed=new Promise(resolve=>{resume=resolve;}),actual=new EventEmitter(),enabled=[];
  let calls=0,closed=0;actual.send=async(...args)=>{enabled.push(args);};actual.detach=async()=>{closed++;};
  const bounds=async operation=>{const value=await operation;if(++calls===1)await resumed;return value;};
  const staged=await networkOwner({context:()=>({newCDPSession:async()=>actual})},[],bounds,body);
  await new Promise(resolve=>setImmediate(resolve));
  try {staged.retire();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);resume();await staged.ready;
   assert.deepEqual(enabled,[],'retirement after session arrival cannot activate diagnostics');assert.deepEqual(actual.eventNames(),[]);
  }finally{resume();await staged.ready;await staged.stop();}
 };
 await postArrivalRetirement(source);
 const retirementGuard='if (acquired && !retired) {';assert.equal(source.split(retirementGuard).length,2);
 await assert.rejects(postArrivalRetirement(source.replace(retirementGuard,'if (acquired) {')),assert.AssertionError);
 const start=source.indexOf('async function bounded('),end=source.indexOf('\nfunction sanitizedFailure(',start);
 assert(start>=0&&end>start);const boundedSource=source.slice(start,end);
 const child=body=>spawnSync(process.execPath,['--input-type=module','--eval',
  "const errors={TimeoutError:class TimeoutError extends Error{}};\n"+body+
  "\nbounded(new Promise(()=>{}),true).catch(()=>{});console.log('diagnostic-does-not-own-process');"],{encoding:'utf8',timeout:500,maxBuffer:65536});
 const detachedTimer=child(boundedSource);assert.ifError(detachedTimer.error);assert.equal(detachedTimer.status,0);
 assert.equal(detachedTimer.stdout.trim(),'diagnostic-does-not-own-process');
 const unref='if (diagnostic) timer.unref();';assert.equal(boundedSource.split(unref).length,2);
 const liveTimer=child(boundedSource.replace(unref,''));assert.equal(liveTimer.error?.code,'ETIMEDOUT');
 const timerLiteral='10_000';assert.equal(boundedSource.split(timerLiteral).length,2);
 const bodyTimer=spawnSync(process.execPath,['--input-type=module','--eval',
  "const errors={TimeoutError:class TimeoutError extends Error{}};\n"+boundedSource.replace(timerLiteral,'25')+
  "\ntry{await bounded(new Promise(()=>{}));throw new Error('missing body deadline');}catch(error){if(!(error instanceof errors.TimeoutError))throw error;console.log('body-deadline-still-owned');}"],
  {encoding:'utf8',timeout:1000,maxBuffer:65536});
 assert.ifError(bodyTimer.error);assert.equal(bodyTimer.status,0);assert.equal(bodyTimer.stdout.trim(),'body-deadline-still-owned');
});
test('only successful owned browser retirement can dispose a pending detach and never an acquisition',async()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const start=source.indexOf('function diagnosticRetirementRegistry('),end=source.indexOf('\n// CDP observations',start);
 const code=source.slice(start,end);
 const factory=body=>runInNewContext('('+body+')',{bounded:operation=>operation})();
 const exercise=async(body,mode)=>{
  const registry=factory(body);let connected=true,closeCalls=0,detaches=0,releaseClose,releaseDetach;
  const closeGate=new Promise(resolve=>{releaseClose=resolve;});
  const detachGate=new Promise(resolve=>{releaseDetach=resolve;});
  const browser={isConnected:()=>connected,close:async()=>{
   closeCalls++;connected=false;
   if(mode==='rejected')throw new Error('private-close-failure');
   if(mode==='pending')await closeGate;
  }};
  let retired=false,joined=false;
  const work=registry.retire(()=>{detaches++;return detachGate;}).then(()=>{retired=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(detaches,1);
  registry.beginClose();
  let acquired=false;
  assert.throws(()=>registry.acquire(()=>{acquired=true;}),/ownership is uncertain/);assert.equal(acquired,false);
  // Admission uncertainty is deliberately retained, separate from disposal.
  const join=registry.join().then(()=>{joined=true;},()=>{joined=true;});
  const closing=registry.closeBrowser(browser);
  if(mode==='rejected')await assert.rejects(closing,/private-close-failure/);
  if(mode==='pending'||mode==='rejected'){
   await new Promise(resolve=>setImmediate(resolve));assert.equal(retired,false);assert.equal(joined,false);
   assert.equal(registry.summary().closed_browser_transfers,0,'mere physical disconnect cannot mint authority');
  }
  if(mode==='pending'){releaseClose();await closing;}
  if(mode==='successful')await closing;
  if(mode==='rejected')releaseDetach();
  await work;await join;
  assert.equal(closeCalls,1);assert.equal(registry.summary().unresolved_detaches,0);
  assert.equal(registry.summary().actual_detaches_settled,mode==='rejected'?1:0);
  assert.equal(registry.summary().closed_browser_transfers,mode==='rejected'?0:1);
  await assert.rejects(registry.closeBrowser(browser),/ownership is uncertain|browser ownership is uncertain/);
  releaseDetach();
 };
 for(const mode of ['successful','pending','rejected'])await exercise(code,mode);
 const pending=factory(code);let resolveAcquisition,drained=false,connected=true;
 const acquisition=pending.acquire(()=>new Promise(resolve=>{resolveAcquisition=resolve;}));
 await new Promise(resolve=>setImmediate(resolve));pending.beginClose();
 const joining=pending.join().then(()=>{drained=true;});
 await pending.closeBrowser({isConnected:()=>connected,close:async()=>{connected=false;}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
 assert.equal(pending.summary().unresolved_acquisitions,1);
 resolveAcquisition();await acquisition;await joining;assert.equal(pending.summary().unresolved_acquisitions,0);
 const unexpected=factory(code);unexpected.beginClose();let called=false;
 await assert.rejects(unexpected.closeBrowser({isConnected:()=>false,close:async()=>{called=true;}}),/browser ownership is uncertain/);
 assert.equal(called,false);await assert.rejects(unexpected.join(),/browser ownership is uncertain/);
 const timedOut=runInNewContext('('+code+')',{bounded:async()=>{throw new Error('diagnostic deadline');}})();
 let timeoutDetached=0,timeoutDone=false,timeoutConnected=true;
 const timeoutWork=timedOut.retire(()=>{timeoutDetached++;return new Promise(()=>{});}).then(()=>{timeoutDone=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(timeoutDetached,1);assert.equal(timeoutDone,false);
 assert.equal(timedOut.summary().unresolved_detaches,1,'diagnostic timeout is not disposal');
 timedOut.beginClose();
 await timedOut.closeBrowser({isConnected:()=>timeoutConnected,close:async()=>{timeoutConnected=false;}});
 await timeoutWork;await timedOut.join();assert.equal(timedOut.summary().closed_browser_transfers,1);
 const stillConnected=async body=>{
  const registry=factory(body);let release,done=false;
  const work=registry.retire(()=>new Promise(resolve=>{release=resolve;})).then(()=>{done=true;});
  await new Promise(resolve=>setImmediate(resolve));registry.beginClose();
  try {
   await assert.rejects(registry.closeBrowser({isConnected:()=>true,close:async()=>{}}),/browser retirement is uncertain/);
   await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
   assert.equal(registry.summary().closed_browser_transfers,0);
  }finally{release();await work;await registry.join();}
 };
 await stillConnected(code);
 const disconnectedGuard="      if (value.isConnected()) throw new Error('diagnostic browser retirement is uncertain');";
 assert.equal(code.split(disconnectedGuard).length,2);
 await assert.rejects(stillConnected(code.replace(disconnectedGuard,'')),assert.AssertionError);
 const observed=factory(code);let rejectDetach,observedConnected=true;
 const transferred=observed.retire(()=>new Promise((_,reject)=>{rejectDetach=reject;}));
 await new Promise(resolve=>setImmediate(resolve));observed.beginClose();
 await observed.closeBrowser({isConnected:()=>observedConnected,close:async()=>{observedConnected=false;}});
 await transferred;await observed.join();rejectDetach(new Error('private-late-detach-refusal'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(observed.summary().closed_browser_transfers,1);
 const release='      releaseBrowser();';assert.equal(code.split(release).length,2);
 const onlyFulfilledClose=code.replace('      await value.close();','      try { await value.close(); } catch {}');
 await assert.rejects(exercise(onlyFulfilledClose,'rejected'),assert.AssertionError);
 const noAcquisitionTransfer=code.replace('entry.work = Promise.resolve().then(operation).finally(',
  "entry.work = Promise.race([Promise.resolve().then(operation),browserRetired]).finally(");
 assert.notEqual(noAcquisitionTransfer,code);
 const pendingGuard=async body=>{
  const registry=factory(body);registry.acquire(()=>new Promise(()=>{}));registry.beginClose();let done=false,connected=true;
  void registry.join().then(()=>{done=true;});
  await registry.closeBrowser({isConnected:()=>connected,close:async()=>{connected=false;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false,'physical close cannot drop unfinished acquisition');
 };
 await pendingGuard(code);await assert.rejects(pendingGuard(noAcquisitionTransfer),assert.AssertionError);
});
test('a timed-out CDP acquisition still owns and detaches its real late arrival',async()=>{
 let resolve;const arrival=new Promise(yes=>{resolve=yes;}),events=[];let detached=0;
 const session=new EventEmitter();session.detach=async()=>{detached++;};session.send=async()=>assert.fail('retired acquisition cannot enable observations');
 const target={context:()=>({newCDPSession:()=>arrival})};
 let calls=0;const bounded=async operation=>{if(++calls===1)throw new Error('acquisition deadline');return operation;};
 const owner=await networkOwner(target,events,bounded);await owner.ready;assert.equal(owner.summary().state,'unavailable');
 resolve(session);await new Promise(yes=>setImmediate(yes));assert.equal(detached,1);
 await owner.stop();assert.equal(detached,1);assert.deepEqual(events,[]);
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs'),guard='if (retired) { detach(value); return null; }';
 assert.equal(source.split(guard).length,2);let resolveMutant;const mutantArrival=new Promise(yes=>{resolveMutant=yes;});calls=0;detached=0;
 const mutant=await networkOwner({context:()=>({newCDPSession:()=>mutantArrival})},[],bounded,source.replace(guard,''));await mutant.ready;
 resolveMutant(session);await new Promise(yes=>setImmediate(yes));assert.throws(()=>assert.equal(detached,1),assert.AssertionError);
 await mutant.stop();assert.equal(detached,1);
});
test('CDP setup refusal and detach rejection remain unavailable diagnostics without replacing a body failure',async()=>{
 const session=new EventEmitter(),events=[];let detached=0;
 session.send=async()=>{throw new Error('private-setup-failure');};
 session.detach=async()=>{detached++;throw new Error('private-detach-failure');};
 const owner=await networkOwner({context:()=>({newCDPSession:async()=>session})},events);
 await owner.ready;
 assert.equal(owner.summary().state,'unavailable');assert.deepEqual(session.eventNames(),[]);
 const primary=new Error('original-body-failure');let caught;
 try{try{throw primary;}finally{await owner.stop();}}catch(error){caught=error;}
 assert.equal(caught,primary);assert.equal(detached,1);assert.deepEqual(events,[]);
});
test('CDP diagnostics bind exact intent request ordinals without exposing protocol identifiers or payloads',()=>{
 const session=new EventEmitter(),events=[],expected={version:1,name:'application.invoke',payload:'private-draft-71943'};
 const observer=networkObserver(session,expected,events);
 session.emit('Network.requestWillBeSent',{requestId:'private-protocol-identifier',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST',postData:JSON.stringify(expected)}});
 session.emit('Network.responseReceived',{requestId:'private-protocol-identifier',response:{status:200,fromServiceWorker:false,fromDiskCache:false,headers:{secret:'private-header'}}});
 session.emit('Network.dataReceived',{requestId:'private-protocol-identifier',dataLength:31,encodedDataLength:31,data:'private-response'});
 session.emit('Network.loadingFinished',{requestId:'private-protocol-identifier',encodedDataLength:176});
 assert.deepEqual(events,[{event:'cdp-request',request:1,method:'POST',payloadMatches:true,payloadOversized:false,redirect:false},
  {event:'cdp-response',request:1,status:200,serviceWorker:false,diskCache:false},
  {event:'cdp-data',request:1,bytes:31,encodedBytes:31},{event:'cdp-finished',request:1,encodedBytes:176}]);
 assert.deepEqual(JSON.parse(JSON.stringify(observer.summary())),{state:'observed',requests:1,overflow:false});
 assert(!JSON.stringify(events).includes('private-'));observer.stop();
});
test('CDP diagnostics ignore other endpoints and preserve mismatched, duplicated and redirected request observations',()=>{
 const session=new EventEmitter(),events=[],expected={version:1,payload:'expected'},observer=networkObserver(session,expected,events);
 session.emit('Network.requestWillBeSent',{requestId:'other',request:{url:'http://other.invalid/_hologram/intent',method:'POST',postData:JSON.stringify(expected)}});
 session.emit('Network.responseReceived',{requestId:'other',response:{status:200}});assert.deepEqual(events,[]);
 for(const requestId of ['first','second'])session.emit('Network.requestWillBeSent',{requestId,request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'private-method',postData:'private-malformed-json'}});
 session.emit('Network.requestWillBeSent',{requestId:'first',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'GET'},redirectResponse:{body:'private-response'}});
 assert.deepEqual(events.map(({request,method,payloadMatches,redirect})=>({request,method,payloadMatches,redirect})),
  [{request:1,method:'OTHER',payloadMatches:false,redirect:false},{request:2,method:'OTHER',payloadMatches:false,redirect:false},
   {request:1,method:'GET',payloadMatches:null,redirect:true}]);
 assert(!JSON.stringify(events).includes('private-'));observer.stop();
});
test('CDP diagnostics bound request and event inventories and close arbitrary failure reasons and byte counts',()=>{
 const session=new EventEmitter(),events=[],observer=networkObserver(session,{},events);
 for(let index=0;index<33;index++)session.emit('Network.requestWillBeSent',{requestId:String(index),request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST'}});
 assert.equal(events.length,32);assert.deepEqual(JSON.parse(JSON.stringify(observer.summary())),{state:'observed',requests:32,overflow:true});
 events.length=0;
 session.emit('Network.loadingFailed',{requestId:'0',errorText:'net::ERR_ABORTED',canceled:true});
 session.emit('Network.loadingFailed',{requestId:'1',errorText:'private-browser-error'});
 session.emit('Network.dataReceived',{requestId:'0',dataLength:-1,encodedDataLength:16777217});
 session.emit('Network.dataReceived',{requestId:'32',dataLength:1,encodedDataLength:1});
 assert.deepEqual(events,[{event:'cdp-failed',request:1,cancelled:true,reason:'ERR_ABORTED'},
  {event:'cdp-failed',request:2,cancelled:false,reason:'other'},{event:'cdp-data',request:1,bytes:null,encodedBytes:null}]);
 assert(!JSON.stringify(events).includes('private-'));observer.stop();
});
test('retiring CDP diagnostics removes listeners and blocks late observations even if detachment fails',()=>{
 for(const broken of [false,true]){
  const session=new EventEmitter(),events=[],observer=networkObserver(session,{},events);
  if(broken)session.off=()=>{throw new Error('private-diagnostic-failure');};
  assert.doesNotThrow(()=>observer.stop());assert.doesNotThrow(()=>observer.stop());
  session.emit('Network.requestWillBeSent',{requestId:'late',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST'}});
  assert.deepEqual(events,[]);if(!broken)assert.deepEqual(session.eventNames(),[]);
 }
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 assert(source.includes("acquired.send('Network.enable')"));
 for(const method of ['Network.getResponseBody','Network.setCacheDisabled','Network.setBypassServiceWorker','Network.setBlockedURLs'])
  assert(!source.includes(`send('${method}'`));
 assert(!source.includes('maxTotalBufferSize'));assert(!source.includes('maxResourceBufferSize'));
 assert(source.includes('try { replyBody = await bounded(reply.body()); }'));
});
test('diagnostic version 2 retains only closed CDP observations while version 1 cannot acquire new fields',()=>{
 const row={schema:'prismpm/browser-submission-diagnostic/2',eventsTruncated:true,network:{state:'observed',requests:1,overflow:false,secret:'private-value'},events:[
  {event:'cdp-failed',request:1,cancelled:true,reason:'ERR_ABORTED',requestId:'private-value',headers:'private-value',body:'private-value'}]};
 const value={schema:'prismpm/portable-oracle-probe/1',diagnostics:[row],exit_code:1,signal:null,probe_passed:false};
 for(const name of ['source','matrix','driver','oracle','model','archive','wasm','node','browser'])value[name+'_sha256']='a'.repeat(64);
 let summary=probeSummary(value).diagnostics[0];assert.deepEqual(summary.network,{state:'observed',requests:1,overflow:false});
 assert.equal(summary.events_truncated,true);
 assert.equal(summary.events[0].event,'cdp-failed');assert.equal(summary.events[0].request,1);
 assert(!JSON.stringify(summary).includes('private-value'));
 row.schema='prismpm/browser-submission-diagnostic/1';summary=probeSummary(value).diagnostics[0];
 assert(!Object.hasOwn(summary,'network'));assert(!Object.hasOwn(summary,'events_truncated'));
 assert(!Object.hasOwn(summary.events[0],'request'));assert.equal(summary.events[0].event,'other');
});
test('CDP ownership regressions reject real endpoint, request-bound, payload-match and late-observation guard mutants',()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const mutations=[
  ["if (value.request?.url !== endpoint) return;",'',(session,events)=>{
   session.emit('Network.requestWillBeSent',{requestId:'other',request:{url:'http://other.invalid/intent',method:'POST'}});
   assert.deepEqual(events,[]);
  }],
  ["if (requests.size === 32) { overflow = true; return; }",'',(session,events,observer)=>{
   for(let i=0;i<33;i++)session.emit('Network.requestWillBeSent',{requestId:String(i),request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST'}});
   assert.equal(observer.summary().requests,32);
  }],
  ["assert.deepEqual(JSON.parse(value.request.postData), expectedRequest);",'',(session,events)=>{
   session.emit('Network.requestWillBeSent',{requestId:'wrong',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST',postData:'{"wrong":true}'}});
   assert.equal(events[0].payloadMatches,false);
  }],
  ["active = false;","active = true;",(session,events,observer)=>{
   session.off=()=>{throw new Error('private-diagnostic-failure');};observer.stop();
   session.emit('Network.requestWillBeSent',{requestId:'late',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST'}});
   assert.deepEqual(events,[]);
  }],
 ];
 for(const [before,after,regression] of mutations){
  assert.equal(source.split(before).length,2);const session=new EventEmitter(),events=[];
  const observer=networkObserver(session,{expected:true},events,source.replace(before,after));
  assert.throws(()=>regression(session,events,observer),assert.AssertionError);observer.stop();
 }
});
test('diagnostic post-data parsing has exact portable-envelope allocation bounds',()=>{
 const session=new EventEmitter(),events=[],maximum=65_536*6+256;
 const expected={payload:'x'.repeat(maximum-14)},encoded=JSON.stringify(expected);assert.equal(encoded.length,maximum);
 const observer=networkObserver(session,expected,events);
 session.emit('Network.requestWillBeSent',{requestId:'maximum',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST',postData:encoded}});
 session.emit('Network.requestWillBeSent',{requestId:'one-over',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST',postData:encoded+' '}});
 assert.equal(events[0].payloadMatches,true);assert.equal(events[0].payloadOversized,false);
 assert.equal(events[1].payloadMatches,null);assert.equal(events[1].payloadOversized,true);observer.stop();
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs'),guard=' && !payloadOversized';
 assert.equal(source.split(guard).length,2);const mutated=[];
 const mutant=networkObserver(session,expected,mutated,source.replace(guard,''));
 session.emit('Network.requestWillBeSent',{requestId:'oversized',request:{url:'http://127.0.0.1:38129/_hologram/intent',method:'POST',postData:encoded+' '}});
 assert.throws(()=>assert.equal(mutated[0].payloadMatches,null),assert.AssertionError);mutant.stop();
});
test('the production event recorder exposes exact32 and one-over truncation without replacing earlier events',()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const start=source.indexOf('  const events = [];'),end=source.indexOf('  let invocation;',start);assert(start>=0&&end>start);
 const factory=body=>runInNewContext(body+'\n({record, snapshot:()=>({events,eventsTruncated})})');
 const recorder=factory(source.slice(start,end));for(let i=0;i<32;i++)recorder.record({event:'request',ordinal:i});
 assert.equal(recorder.snapshot().events.length,32);assert.equal(recorder.snapshot().eventsTruncated,false);
 recorder.record({event:'request',ordinal:32});assert.equal(recorder.snapshot().events.length,32);
 assert.equal(recorder.snapshot().eventsTruncated,true);assert.equal(recorder.snapshot().events.at(-1).ordinal,31);
 const guard='else eventsTruncated = true;';assert.equal(source.slice(start,end).split(guard).length,2);
 const mutant=factory(source.slice(start,end).replace(guard,''));for(let i=0;i<33;i++)mutant.record({event:'request'});
 assert.throws(()=>assert.equal(mutant.snapshot().eventsTruncated,true),assert.AssertionError);
});
test('actual submission completion owns both rejections and preserves correlated response failure',async()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const start=source.indexOf('async function submissionCompletion('),end=source.indexOf('\nasync function submit(',start);
 assert(start>=0&&end>start,'actual source-owned completion helper');
 const completion=runInNewContext(source.slice(start,end)+'\nsubmissionCompletion');
 const pending=new Promise(()=>{}),bodyFailure=new Error('private-body'),triggerFailure=new Error('private-trigger');
 for(const [bodyDelay,triggerDelay] of [[0,5],[5,0]]) {
  const rejected=(failure,delay)=>new Promise((_,reject)=>setTimeout(()=>reject(failure),delay));
  await assert.rejects(completion(rejected(bodyFailure,bodyDelay),rejected(triggerFailure,triggerDelay),pending),error=>error===bodyFailure);
 }
 const value={reply:{},replyBody:Buffer.from('actual observed body')};
 assert.equal(await completion(Promise.resolve(value),Promise.resolve(),pending),value);
 await assert.rejects(completion(Promise.resolve(value),Promise.reject(triggerFailure),pending),error=>error===triggerFailure);
 const navigationFailure=new Error('private-navigation');
 // An already observed body failure must not wait for a pending trigger and
 // then lose to a later navigation. Both other promises remain observed.
 const bodyBeforeNavigation=async operation=>{
  let releaseTrigger,rejectLaterNavigation;
  const pendingTrigger=new Promise(resolve=>{releaseTrigger=resolve;}),laterNavigation=new Promise((_,reject)=>{rejectLaterNavigation=reject;});
  const bodyFirst=operation(Promise.reject(bodyFailure),pendingTrigger,laterNavigation);
  void bodyFirst.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  rejectLaterNavigation(navigationFailure);
  try { await assert.rejects(bodyFirst,error=>error===bodyFailure); }
  finally { releaseTrigger(); await new Promise(resolve=>setImmediate(resolve)); }
 };
 await bodyBeforeNavigation(completion);
 await assert.rejects(completion(pending,pending,Promise.reject(navigationFailure)),error=>error===navigationFailure);
 // A navigation winner still attaches rejection observers to both operations.
 let rejectBody,rejectTrigger;
 const body=new Promise((_,reject)=>{rejectBody=reject;}),trigger=new Promise((_,reject)=>{rejectTrigger=reject;});
 await assert.rejects(completion(body,trigger,Promise.reject(navigationFailure)),error=>error===navigationFailure);
 rejectBody(bodyFailure);rejectTrigger(triggerFailure);await new Promise(resolve=>setImmediate(resolve));
 const guard='  const completed = Promise.resolve(response).then(async body => {';
 const original=source.slice(start,end);assert.equal(original.split(guard).length,2);
 const mutant=runInNewContext(original.replace(guard,"  const completed = Promise.allSettled([response, trigger]).then(async ([observedBody]) => {\n    if (observedBody.status === 'rejected') throw observedBody.reason;\n    const body = observedBody.value;")+'\nsubmissionCompletion');
 await assert.rejects(bodyBeforeNavigation(mutant),assert.AssertionError);
 const triggerGuard="    if (initiated.status === 'rejected') throw initiated.reason;";
 assert.equal(original.split(triggerGuard).length,2);
 const triggerMutant=runInNewContext(original.replace(triggerGuard,'')+'\nsubmissionCompletion');
 await assert.rejects(assert.rejects(triggerMutant(Promise.resolve(value),Promise.reject(triggerFailure),pending),error=>error===triggerFailure),assert.AssertionError);
 assert.equal(source.split('await submissionCompletion(response, trigger, navigation)').length,2);
});
test('actual submission diagnostic emission and cleanup retain the first body failure when both diagnostic sinks throw',async()=>{
 const source=read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
 const start=source.indexOf('function failureKind('),end=source.indexOf('\n// CDP observations',start);
 const bodyFailure=new Error('private-body-failure'),failedBodies=new WeakSet([bodyFailure]);let emissions=0;
 const helpers=runInNewContext(source.slice(start,end)+'\n({failureKind,sanitizedFailure,emitDiagnostic,diagnosticRetirementRegistry})',
  {assert,errors:{TimeoutError:class extends Error{}},failedBodies,unavailableBodies:new WeakSet(),sanitizedFailures:new WeakSet(),
   setTimeout,clearTimeout,console:{error(){emissions++;throw new Error('private-sink-failure');}}});
 assert.doesNotThrow(()=>helpers.emitDiagnostic({schema:'prismpm/browser-submission-diagnostic/2',failure:'response-body-failed'}));
 const primary=helpers.sanitizedFailure(bodyFailure,'response-body');
 const tailStart=source.lastIndexOf('  let cleanupFailure;'),tailEnd=source.trimEnd().length-1;
 assert(tailStart>=0&&tailEnd>tailStart);let closed=0,destroyed=0;
 const invoke=primaryFailure=>runInNewContext('(async()=>{'+source.slice(tailStart,tailEnd)+'})',
  {...helpers,primaryFailure,diagnosticCleanup:helpers.diagnosticRetirementRegistry(),bounded:operation=>operation,browser:{isConnected:()=>true,close:async()=>{closed++;throw new Error('private-cleanup-failure');}},
   process:{stdin:{destroy(){destroyed++;throw new Error('private-stdin-failure');}}}})();
 await assert.rejects(invoke(primary),error=>error===primary);assert.equal(closed,1);assert.equal(destroyed,1);
 await assert.rejects(invoke(undefined),error=>error.message==='portable View oracle cleanup: unexpected');
 assert.equal(closed,2);assert.equal(destroyed,2);assert.equal(emissions,5);
 const registry=helpers.diagnosticRetirementRegistry();let releaseParent,releaseChild,joined=false,childFinished=false;
 const parent=new Promise(resolve=>{releaseParent=resolve;}),child=new Promise(resolve=>{releaseChild=resolve;});
 registry.own(async()=>{await parent;registry.own(async()=>{await child;childFinished=true;});});
 const joining=registry.join().then(()=>{joined=true;});releaseParent();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,false);
 releaseChild();await joining;assert.equal(childFinished,true);registry.check();
 let lateStarted=false;assert.throws(()=>registry.own(()=>{lateStarted=true;}),/ownership is uncertain/);
 assert.equal(lateStarted,false);assert.throws(()=>registry.check(),/ownership is uncertain/);
 const crowded=helpers.diagnosticRetirementRegistry();let releaseCrowd,overflowStarted=false;
 const crowd=new Promise(resolve=>{releaseCrowd=resolve;});
 for(let i=0;i<128;i++)crowded.own(()=>crowd);
 assert.throws(()=>crowded.own(()=>{overflowStarted=true;}),/ownership is uncertain/);
 assert.equal(overflowStarted,false);releaseCrowd();await assert.rejects(crowded.join(),/ownership is uncertain/);
 const registryStart=source.indexOf('function diagnosticRetirementRegistry('),registryEnd=source.indexOf('\n// CDP observations',registryStart);
 const registryCode=source.slice(registryStart,registryEnd);
 for(const guard of ['sealed || ', 'pending.size >= 128']){
  assert.equal(registryCode.split(guard).length,2);
  const mutantCode=registryCode.replace(guard,guard==='sealed || '?'':'false');
  const refuseBoundary=async code=>{
   const actual=runInNewContext('('+code+')')();
   if(guard==='sealed || ')await actual.join();
   else for(let i=0;i<128;i++)actual.own(()=>Promise.resolve());
   assert.throws(()=>actual.own(()=>{}),/ownership is uncertain/);
   await assert.rejects(actual.join(),/ownership is uncertain/);
  };
  await refuseBoundary(registryCode);
  // Removing either actual guard must fail the same owning refusal predicate.
  await assert.rejects(refuseBoundary(mutantCode),assert.AssertionError);
 }
 const aboveCapacity=code=>{
  // Fault-inject an already-over-capacity counter into the actual guard.
  class OverCapacitySet extends Set {get size(){return 129;}}
  const actual=runInNewContext('('+code+')',{Set:OverCapacitySet})();let started=false;
  assert.throws(()=>actual.own(()=>{started=true;}),/ownership is uncertain/);assert.equal(started,false);
 };
 aboveCapacity(registryCode);
 assert.throws(()=>aboveCapacity(registryCode.replace('pending.size >= 128','pending.size === 128')),assert.AssertionError);
 const rejection=helpers.diagnosticRetirementRegistry(),unexpected=new Error('private-operation-failure');
 await assert.rejects(rejection.own(()=>Promise.reject(unexpected)),error=>error===unexpected);
 await assert.rejects(rejection.join(),/diagnostic cleanup operation failed/);
 assert.throws(()=>rejection.check(),/diagnostic cleanup operation failed/);
 const sealed=helpers.diagnosticRetirementRegistry();await sealed.join();let acquisitions=0;
 const afterSeal=await networkOwner({context:()=>({newCDPSession:async()=>{acquisitions++;return new EventEmitter();}})},[],operation=>operation,source,sealed);
 await afterSeal.ready;await afterSeal.stop();assert.equal(acquisitions,0);
 assert.equal(afterSeal.summary().state,'unavailable');assert.throws(()=>sealed.check(),/ownership is uncertain/);
 const ownedRejection=async code=>{
  const actual=runInNewContext('('+code+')')(),failure=new Error('private-rejection');
  await assert.rejects(actual.own(()=>Promise.reject(failure)),error=>error===failure);
  await assert.rejects(actual.join(),/diagnostic cleanup operation failed/);
 };
 const rejectionGuard="      uncertainty ??= new Error('diagnostic cleanup operation failed');";
 assert.equal(registryCode.split(rejectionGuard).length,2);
 await ownedRejection(registryCode);
 await assert.rejects(ownedRejection(registryCode.replace(rejectionGuard,'')),assert.AssertionError);
 const lateAcquisition=async code=>{
  const actual=runInNewContext('('+code+')',{bounded:operation=>operation})();let resolveArrival,done=false,detached=0,enabled=0;
  const arrival=new Promise(resolve=>{resolveArrival=resolve;}),session=new EventEmitter();
  session.detach=async()=>{detached++;};session.send=async()=>{enabled++;};
  const observer=await networkOwner({context:()=>({newCDPSession:()=>arrival})},[],operation=>operation,source,actual);
  observer.retire();const complete=actual.join().then(()=>{done=true;});
  try {
   await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false,'pending physical acquisition must remain owned through final join');
   resolveArrival(session);await complete;await observer.stop();actual.check();
   assert.equal(detached,1);assert.equal(enabled,0);assert.deepEqual(session.eventNames(),[]);
  }finally{resolveArrival(session);await observer.stop();await complete.catch(()=>{});}
 };
 await lateAcquisition(registryCode);
 const registrationGuard='    pending.add(entry);';assert.equal(registryCode.split(registrationGuard).length,2);
 await assert.rejects(lateAcquisition(registryCode.replace(registrationGuard,'')),assert.AssertionError);
});
test('diagnostics retain exact independently measured subjects and drivers incrementally outside acceptance evidence',t=>{
 const root=diagnosticRoot(t),source=join(root,'actual-driver.mjs'),body=Buffer.from('export const sourceOwned = true;\n');writeFileSync(source,body);
 const bundle=new PortableDiagnosticBundle(root);bundle.file('cases/0-click-positive.driver.mjs',source,hash(body));
 assert(bundle.path.startsWith(join(root,'target/ci-diagnostics/portable-oracle-')));
 const index=JSON.parse(readFileSync(join(bundle.path,'index.json')));
 assert.equal(index.scope,'diagnostics-only-not-acceptance');assert.equal(index.state,'collecting');assert.equal(index.files.length,1);
 assert.equal(index.files[0].sha256,hash(body));assert(readFileSync(join(bundle.path,index.files[0].path)).equals(body));
 bundle.json('outcomes.json',{cases:[{id:'0-click-positive',status:'passed'}]});bundle.complete();
 assert.equal(JSON.parse(readFileSync(join(bundle.path,'index.json'))).state,'completed');
 assert.throws(()=>bundle.bytes('late',Buffer.alloc(0)));
 const matrixSource=read('scripts/portable-oracle-matrix.mjs');assert(matrixSource.includes("'scripts/portable-oracle-diagnostics.mjs'"));
 assert(matrixSource.indexOf('original_receipt_sha256')<matrixSource.indexOf('assert.ifError(result.error)'));
 for(const path of ['.github/workflows/vv.yml','.github/workflows/bootstrap.yml'])assert(read(path).includes('target/ci-diagnostics/'));
});
test('diagnostic custody rejects aliases, hard links, substituted hashes and unowned destinations without acceptance',t=>{
 const root=diagnosticRoot(t),source=join(root,'source');writeFileSync(source,'source');const bundle=new PortableDiagnosticBundle(root);
 symlinkSync(source,join(root,'alias'));linkSync(source,join(root,'linked'));
 for(const path of [source,join(root,'alias'),join(root,'linked'),root])assert.throws(()=>bundle.file('refused',path,hash('source')));
 rmSync(join(root,'linked'));assert.throws(()=>bundle.file('refused',source,hash('substitution')));
 for(const path of ['../escape','/absolute','a/../escape','a//escape','a\\escape','a/'.repeat(80)+'x'])assert.throws(()=>bundle.bytes(path,Buffer.alloc(0)));
 const outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,join(bundle.path,'escape'));
 assert.throws(()=>bundle.bytes('escape/file',Buffer.from('unowned')));assert(!existsSync(join(outside,'file')));
 rmSync(join(bundle.path,'escape'));bundle.bytes('data',Buffer.from('original'));
 assert.throws(()=>bundle.bytes('data',Buffer.from('overwrite')));assert.equal(readFileSync(join(bundle.path,'data'),'utf8'),'original');
 const saved=bundle.path+'-saved';renameSync(bundle.path,saved);symlinkSync(outside,bundle.path);
 assert.throws(()=>bundle.bytes('file',Buffer.alloc(0)));assert(!existsSync(join(outside,'file')));
});
test('diagnostic budgets include index headroom and refuse exact one-over file and aggregate inventories',t=>{
 const root=diagnosticRoot(t),bundle=new PortableDiagnosticBundle(root),maximum=Buffer.alloc(diagnosticLimits.fileBytes);
 bundle.bytes('maximum',maximum);assert.throws(()=>bundle.bytes('oversize',Buffer.alloc(maximum.length+1)));
 const remainder=diagnosticLimits.totalBytes-2*diagnosticLimits.indexBytes-maximum.length;
 bundle.bytes('remainder',Buffer.alloc(remainder));assert.throws(()=>bundle.bytes('one-over',Buffer.of(1)));bundle.complete();
 const entries=new PortableDiagnosticBundle(root);for(let index=0;index<diagnosticLimits.files-2;index++)entries.bytes('row-'+index,Buffer.alloc(0));
 assert.throws(()=>entries.bytes('one-over',Buffer.alloc(0)));entries.complete();
 const source=join(root,'oversized');writeFileSync(source,maximum);assert.throws(()=>readDiagnosticFile(source,maximum.length-1));
});
test('changed, missing, additional or aliased retained bytes never become complete diagnostics',t=>{
 const root=diagnosticRoot(t);
 for(const mutate of [bundle=>writeFileSync(join(bundle.path,'data'),'changed'),bundle=>rmSync(join(bundle.path,'data')),
  bundle=>writeFileSync(join(bundle.path,'extra'),'unowned'),bundle=>mkdirSync(join(bundle.path,'unowned')),
  bundle=>{renameSync(join(bundle.path,'data'),join(bundle.path,'saved'));symlinkSync(join(bundle.path,'saved'),join(bundle.path,'data'));},
  bundle=>writeFileSync(join(bundle.path,'index.json'),'{}')]){
  const bundle=new PortableDiagnosticBundle(root);bundle.bytes('data',Buffer.from('original'));mutate(bundle);assert.throws(()=>bundle.complete());
 }
});
test('failed optional collection preserves the original failure and never emits credentials or a positive receipt',t=>{
 const bundle=new PortableDiagnosticBundle(diagnosticRoot(t)),output=[];
 const original=new Error('original-browser-failure');assert.throws(()=>{
  try{throw original;}catch(error){assert.equal(retainDiagnostic(bundle,()=>{throw new Error('private-credential');},value=>output.push(value)),false);throw error;}
 },error=>error===original);
 assert.deepEqual(output,['portable oracle diagnostic bundle incomplete\n']);
 assert.equal(JSON.parse(readFileSync(join(bundle.path,'index.json'))).state,'incomplete');
 assert.equal(retainDiagnostic(bundle,()=>assert.fail('incomplete bundle cannot resume')),false);
 bundle.finish({cases:[{id:'0-click-positive',status:'failed'}],negative_controls:[]},true);
 assert.equal(JSON.parse(readFileSync(join(bundle.path,'index.json'))).state,'incomplete');
 assert.deepEqual(JSON.parse(readFileSync(join(bundle.path,'outcomes.json'))).cases,[{id:'0-click-positive',status:'failed'}]);
 const brokenSink=new PortableDiagnosticBundle(diagnosticRoot(t));
 assert.throws(()=>{try{throw original;}catch(error){
  assert.equal(retainDiagnostic(brokenSink,()=>{throw new Error('collection failed');},()=>{throw new Error('sink failed');}),false);throw error;
 }},error=>error===original);
 const value={schema:'prismpm/portable-oracle-probe/1',exit_code:1,signal:null,probe_passed:false,failure:'private-credential',diagnostics:[{
  schema:'prismpm/browser-submission-diagnostic/1',phase:'private-credential',failure:'private-credential',check:'private-credential',
  vectorIndex:'private-credential',invocationCount:'private-credential',events:[{event:'private-credential',reason:'private-credential',body:'private-credential'}]}]};
 for(const name of ['source','matrix','driver','oracle','model','archive','wasm','node','browser'])value[name+'_sha256']='a'.repeat(64);
 value.diagnostics[0].journey='private-credential';assert.equal(probeSummary(value).diagnostics[0].journey,'other');
 value.diagnostics[0].journey='modeled-vectors';assert.equal(probeSummary(value).diagnostics[0].journey,'modeled-vectors');
 assert(!JSON.stringify(probeSummary(value)).includes('private-credential'));assert.throws(()=>probeSummary({...value,driver_sha256:'private-credential'}));
});
test('actual process interruption leaves previously written diagnostic files and an explicitly incomplete inventory',t=>{
 const root=diagnosticRoot(t),module=new URL('./portable-oracle-diagnostics.mjs',import.meta.url).href;
 const source=`import {PortableDiagnosticBundle} from ${JSON.stringify(module)};const bundle=new PortableDiagnosticBundle(process.argv[1]);bundle.bytes('executed.driver.mjs',Buffer.from('original source'));console.log(bundle.path);process.kill(process.pid,'SIGTERM');`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,root],{encoding:'utf8',timeout:10000,maxBuffer:65536});
 assert.ifError(child.error);assert.equal(child.signal,'SIGTERM');const path=child.stdout.trim();
 const index=JSON.parse(readFileSync(join(path,'index.json')));assert.equal(index.state,'collecting');assert.equal(index.files.length,1);
 assert.equal(readFileSync(join(path,'executed.driver.mjs'),'utf8'),'original source');
});
test('owning diagnostic regressions kill real source, alias, retirement and incomplete-state guard mutants',t=>{
 const root=diagnosticRoot(t),source=read('scripts/portable-oracle-diagnostics.mjs');
 const mutations=[
  ["assert.equal(hash(data),expected,'diagnostic source differs from executed input');",'',
   "writeFileSync(path,'source');assert.throws(()=>bundle.file('copied',path,hash('changed')));"],
  ['before.nlink===1n&&','',
   "writeFileSync(path,'source');linkSync(path,path+'-linked');assert.throws(()=>bundle.file('copied',path,hash('source')));"],
  ["assert.equal(hash(data),row.sha256,'diagnostic copy changed');",'',
   "bundle.bytes('data',Buffer.from('original'));writeFileSync(join(bundle.path,'data'),'tampered');assert.throws(()=>bundle.complete());"],
  ["assert.deepEqual(actual.sort(),[...expected].sort(),'diagnostic output inventory changed');",'',
   "bundle.bytes('data',Buffer.from('original'));writeFileSync(join(bundle.path,'extra'),'unowned');assert.throws(()=>bundle.complete());",
   "assert(expected.has(name),'unexpected diagnostic output');"],
  ["incomplete(){this.state='incomplete';this.index();}","incomplete(){this.state='completed';this.index();}",
   "assert.equal(retainDiagnostic(bundle,()=>{throw new Error('collection failed');},()=>{}),false);assert.equal(JSON.parse(readFileSync(join(bundle.path,'index.json'))).state,'incomplete');"],
 ];
 for(const [index,[before,after,body,redundant]] of mutations.entries()){
  assert.equal(source.split(before).length,2,'mutant targets exactly one actual guard');
  let mutated=source.replace(before,after);
  if(redundant){assert.equal(mutated.split(redundant).length,2);mutated=mutated.replace(redundant,'');}
  const directory=join(root,String(index));mkdirSync(directory);const module=join(directory,'mutant.mjs');writeFileSync(module,mutated);
  const driver=`import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {writeFileSync,readFileSync,linkSync} from 'node:fs';import {join} from 'node:path';import {PortableDiagnosticBundle,retainDiagnostic} from ${JSON.stringify(new URL('file://'+module).href)};const hash=value=>createHash('sha256').update(value).digest('hex');const bundle=new PortableDiagnosticBundle(process.argv[1]);const path=join(process.argv[1],'source');${body}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',driver,directory],{encoding:'utf8',timeout:10000,maxBuffer:65536});
  assert.ifError(child.error);assert.equal(child.signal,null);assert.equal(child.status,1);assert.match(child.stderr,/AssertionError/);
 }
});

test('real traversal mutation of a previously hashed file cannot receive a completed index',t=>{
 const root=diagnosticRoot(t),source=read('scripts/portable-oracle-diagnostics.mjs');let bundle,mutated=false;
 const module=source.replace(/^import .*;$/gm,'').replaceAll('export ','')+'\nPortableDiagnosticBundle';
 const Bundle=runInNewContext(module,{assert,createHash,Buffer,...actualFs,dirname:actualDirname,join,resolve:actualResolve,
  opendirSync(path,options){const iterator=actualFs.opendirSync(path,options),read=iterator.readSync.bind(iterator);
   iterator.readSync=()=>{const entry=read();if(entry&&!mutated){mutated=true;writeFileSync(join(bundle.path,'data'),'tampered');}return entry;};return iterator;}});
 bundle=new Bundle(root);bundle.bytes('data',Buffer.from('original'));assert.throws(()=>bundle.complete());
 assert(mutated);assert.equal(JSON.parse(readFileSync(join(bundle.path,'index.json'))).state,'collecting');
});

test('optional constructor and throwing diagnostic sink cannot interrupt matrix ownership',()=>{
 const source=read('scripts/portable-oracle-matrix.mjs'),start=source.indexOf('let diagnostics;'),end=source.indexOf('retainDiagnostic(diagnostics,',start);
 assert(start>=0&&end>start);let attempted=false;
 assert.doesNotThrow(()=>runInNewContext(source.slice(start,end),{root:'/unused',
  PortableDiagnosticBundle:class{constructor(){attempted=true;throw new Error('destination unavailable');}},
  process:{stderr:{write(){throw new Error('sink unavailable');}}}}));assert(attempted);
});

test('failure-only client observation is bounded and emits no document text or raw exceptions', async () => {
  const source = read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
  const start = source.indexOf('async function failedClientState(');
  const end = source.indexOf('\nasync function fill(', start);
  assert(start >= 0 && end > start);
  const privateText = 'private-oracle-draft-71943';
  const state = {output: {textContent: privateText}, form: {hasAttribute: () => true}, button: {disabled: false}};
  const document = {querySelector: selector => ({'#result': state.output, '#application-form': state.form, '#submit': state.button})[selector]};
  const observeFactory = runInNewContext('(' + source.slice(start, end) + ')',
    {setTimeout, clearTimeout, document, text: true, view: {response_error: 'expected-error'}});
  const observe = (target, expected) => observeFactory(target, () => expected);
  const target = {isClosed: () => false, evaluate: async (fn, args) => fn(args)};
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await observe(target, 'expected-result')), {state: 'observed', outputPresent: true,
    expectedResult: false, responseError: false, busy: true, disabled: false});
  state.output.textContent = 'expected-result';
  assert.equal((await observe(target, 'expected-result')).expectedResult, true);
  state.output.textContent = 'expected-error';
  assert.equal((await observe(target, 'expected-result')).responseError, true);
  state.form.hasAttribute = () => privateText; state.button.disabled = privateText;
  assert(!JSON.stringify(await observe(target, privateText)).includes(privateText));
  assert.deepEqual(plain(await observe({isClosed: () => true}, privateText)), {state: 'closed'});
  assert.deepEqual(plain(await observe({isClosed: () => false, evaluate: async () => {throw new Error(privateText);}}, privateText)), {state: 'unavailable'});
  const began = performance.now();
  assert.deepEqual(plain(await observe({isClosed: () => false, evaluate: () => new Promise(() => {})}, privateText)), {state: 'unavailable'});
  assert(performance.now() - began < 2000, 'failure diagnostics must not hang');
  assert(source.includes('const client = await failedClientState(target, () => displayed(vector));'));
  for (const prepare of [
    () => new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.of(255)),
    () => assert.match('malformed-numeric-response', /^ok\t-?\d+$/),
  ]) {
    const original = new Error('original-network-failure');
    await assert.rejects(async () => {
      try { throw original; }
      catch (error) {
        assert.deepEqual(plain(await observeFactory(target, prepare)), {state: 'unavailable'});
        throw error;
      }
    }, error => error === original);
  }
  assert.deepEqual(plain(await observe({isClosed: () => {throw new Error(privateText);}}, privateText)), {state: 'unavailable'});
});

test('browser request diagnostics expose only closed failure reasons, never raw private text', () => {
  const source = read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
  const start = source.indexOf('function requestFailureReason(value) {');
  const end = source.indexOf('\nfunction failureKind(', start);
  assert(start >= 0 && end > start, 'actual browser failure classifier required');
  const classify = runInNewContext('(' + source.slice(start, end) + ')');
  for (const code of ['ERR_ABORTED', 'ERR_FAILED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
    'ERR_CONTENT_LENGTH_MISMATCH', 'ERR_INCOMPLETE_CHUNKED_ENCODING', 'ERR_INSUFFICIENT_RESOURCES',
    'ERR_TIMED_OUT', 'ERR_BLOCKED_BY_CLIENT', 'ERR_BLOCKED_BY_RESPONSE']) {
    assert.equal(classify('net::' + code), code);
  }
  assert.equal(classify(null), 'unavailable');
  for (const value of [undefined, '', 'private-oracle-draft-71943', 'net::ERR_ABORTED private-oracle-draft-71943',
    'net::ERR_PRIVATE_ORACLE_DRAFT_71943', '__proto__', {}, 1]) assert.equal(classify(value), 'other');
});

test('failed child diagnostics reach the retained gate stream with independent bounds and credential redaction', () => {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write("x".repeat(32765)+"private-credential"+"y".repeat(32768)); process.stderr.write("source bytes differ private-credential"); process.exitCode=19;'],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 131072});
  assert.ifError(result.error);
  assert.equal(result.status, 19);
  const output = [];
  reportChildFailure('source-comparison', result, 0, bytes => output.push(bytes), {GITHUB_TOKEN: 'private-credential'});
  const diagnostic = Buffer.concat(output).toString();
  assert(diagnostic.includes('exit=19'));
  assert(diagnostic.includes('source bytes differ [REDACTED]'));
  assert(!diagnostic.includes('private-credential'));
  assert(!diagnostic.includes('pri'));
  assert(diagnostic.includes('[diagnostic limit reached]'));
  assert(Buffer.byteLength(diagnostic) < 66000);
  reportChildFailure('expected-negative', result, 19, () => assert.fail('expected result is silent'));
});

test('actual V&V observer retains a failing oracle child diagnostic without changing its exit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'portable-failure-log-'));
  try {
    const driver = join(directory, 'driver.mjs');
    writeFileSync(driver, `import {spawnSync} from 'node:child_process';
import {reportChildFailure} from ${JSON.stringify(new URL('./portable-oracle-custody.mjs', import.meta.url).href)};
const result = spawnSync(process.execPath,['-e','process.stderr.write("actual-source-mismatch");process.exitCode=19;'],{encoding:'utf8',timeout:10000,maxBuffer:65536});
reportChildFailure('source-comparison',result,0);
process.exitCode=result.status;
`);
    const evidence = join(directory, 'evidence');
    const result = spawnSync(process.execPath, [new URL('./ci-observe.mjs', import.meta.url).pathname, 'run', evidence, '--', process.execPath, driver],
      {encoding: 'utf8', timeout: 20000, maxBuffer: 65536});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 19, result.stderr);
    assert.match(readFileSync(join(evidence, 'gate.log'), 'utf8'), /oracle stage source-comparison: exit=19[\s\S]*actual-source-mismatch/);
    assert.equal(JSON.parse(readFileSync(join(evidence, 'gate-result.json'))).exitCode, 19);
  } finally { rmSync(directory, {recursive: true}); }
});

test('pinned archive comparison retains complete content and mode custody without requiring root ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'portable-archive-test-'));
  const archive = new URL('../vendor/hologram-live.tar', import.meta.url).pathname;
  const verifier = new URL('./portable-oracle-source.py', import.meta.url).pathname;
  const check = (source, directory) => {
    const result = spawnSync('/usr/bin/python3', ['-I', '-B', verifier, source, directory], {encoding: 'utf8', timeout: 30000, maxBuffer: 65536});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const reject = (source, directory, message) => {
    const result = check(source, directory);
    assert.equal(result.status, 1, result.stderr);
    assert(result.stderr.includes(message), result.stderr);
  };
  try {
    for (const mask of ['0022', '0077']) {
      const directory = join(root, mask);
      mkdirSync(directory);
      const extraction = spawnSync('/bin/sh', ['-c', 'umask "$1"; exec /usr/bin/tar --no-same-owner --same-permissions -xf "$2" -C "$3"', 'extract', mask, archive, directory], {timeout: 30000, maxBuffer: 65536});
      assert.ifError(extraction.error);
      assert.equal(extraction.signal, null);
      assert.equal(extraction.status, 0);
      assert.equal(check(archive, directory).status, 0);
      // Yield an actual unexpected filesystem member first. The comparator
      // must refuse it BEFORE asking the directory iterator for another row.
      const streamControl=`import contextlib, os, runpy, sys
source = runpy.run_path(sys.argv[1])
scan = os.scandir
@contextlib.contextmanager
def guarded_scan(descriptor):
    with scan(descriptor) as entries:
        unexpected = next(entry for entry in entries if entry.name == "unexpected-stream-member")
        def rows():
            yield unexpected
            raise RuntimeError("source enumeration continued after unexpected member")
        yield rows()
os.scandir = guarded_scan
source["verify"](sys.argv[2], sys.argv[3])
`;
      writeFileSync(join(directory,'unexpected-stream-member'),'actual unexpected member');
      try{
        const comparator=readFileSync(verifier,'utf8');
        const start=comparator.indexOf('                names = set()\n');
        const end=comparator.indexOf('            for entry in sorted(names):\n',start);
        assert(start>=0&&end>start,'actual streaming inventory guard exists');
        const mutant=join(root,'buffered-source-comparator.py');
        writeFileSync(mutant,comparator.slice(0,start)+'                names = sorted(entry.name for entry in entries)\n'+comparator.slice(end));
        for(const [selected,expected] of [[verifier,'unexpected source entry'],[mutant,'source enumeration continued after unexpected member']]){
          const result=spawnSync('/usr/bin/python3',['-I','-B','-c',streamControl,selected,archive,directory],
            {encoding:'utf8',timeout:30000,maxBuffer:65536});
          assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,1,result.stderr);
          assert(result.stderr.includes(expected),result.stderr);
          assert.equal(result.stderr.includes('source enumeration continued after unexpected member'),selected===mutant,
            'the actual early-refusal assertion kills buffering-before-validation');
        }
      }finally {rmSync(join(directory,'unexpected-stream-member'));}
      const selected = join(directory, 'Cargo.toml'), original = readFileSync(selected);
      for (const mutation of ['bytes', 'missing', 'extra', 'mode', 'symlink', 'hardlink']) {
        if (mutation === 'bytes') writeFileSync(selected, Buffer.concat([original, Buffer.from('\n')]));
        if (mutation === 'missing') renameSync(selected, join(root, 'removed'));
        if (mutation === 'extra') writeFileSync(join(directory, 'unexpected'), 'extra');
        if (mutation === 'mode') chmodSync(selected, 0o764);
        if (mutation === 'symlink') { renameSync(selected, join(root, 'removed')); symlinkSync(join(root, 'removed'), selected); }
        if (mutation === 'hardlink') linkSync(selected, join(root, 'alias'));
        reject(archive, directory, {bytes: 'source type, mode, size or bytes differ', missing: 'source inventory incomplete',
          extra: 'unexpected source entry', mode: 'source type, mode, size or bytes differ', symlink: 'source alias or special file',
          hardlink: 'source file alias or special file'}[mutation]);
        if (mutation === 'bytes') writeFileSync(selected, original);
        if (mutation === 'missing') renameSync(join(root, 'removed'), selected);
        if (mutation === 'extra') rmSync(join(directory, 'unexpected'));
        if (mutation === 'mode') chmodSync(selected, 0o664);
        if (mutation === 'symlink') { rmSync(selected); renameSync(join(root, 'removed'), selected); }
        if (mutation === 'hardlink') rmSync(join(root, 'alias'));
        assert.equal(check(archive, directory).status, 0, 'restored ' + mutation);
      }
      const changedArchive = join(root, 'changed.tar');
      copyFileSync(archive, changedArchive);
      writeFileSync(changedArchive, Buffer.concat([readFileSync(changedArchive), Buffer.from('x')]));
      reject(changedArchive, directory, 'source archive identity differs');
      const archiveAlias = join(root, 'archive-alias');
      symlinkSync(archive, archiveAlias);
      reject(archiveAlias, directory, 'source file alias or special file');
      rmSync(archiveAlias);
      linkSync(changedArchive, archiveAlias);
      reject(changedArchive, directory, 'source file alias or special file');
      rmSync(archiveAlias);
      const rootAlias = join(root, 'root-alias');
      symlinkSync(directory, rootAlias);
      reject(archive, rootAlias, 'source directory alias');
      rmSync(rootAlias);
      chmodSync(directory, 0o755);
      reject(archive, directory, 'source root mode differs');
      chmodSync(directory, 0o700);
      assert.equal(check(archive, directory).status, 0);
    }
  } finally { rmSync(root, {recursive: true}); }
});

test('wrong-status control changes only its injected route, not other successful journeys', () => {
  const source = read('crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
  assert(source.includes('route.fulfill({status: 200,'));
  const injection = 'uniqueProbe(route.fulfill({status: 200, body: "wrong-envelope"}));';
  const driver = source + '\n' + injection;
  assert.equal(applyNegativeControl(driver, source, injection, 'wrong-status'),
    source + '\n' + injection.replace('status: 200,', 'status: 503,'));
  assert.equal(applyNegativeControl(driver, source, injection, 'noop'), source);
  assert.equal(applyNegativeControl(driver, source, injection, 'none'), driver);
  assert.throws(() => applyNegativeControl(driver + injection, source, injection, 'wrong-status'), /must be unique/);
});

test('registry download sharing cannot import poisoned previously extracted sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'portable-registry-test-'));
  try {
    const source = join(root, 'source'), destination = join(root, 'private');
    for (const name of ['cache', 'index', 'src']) mkdirSync(join(source, 'registry', name), {recursive: true});
    writeFileSync(join(source, 'registry/src/lib.rs'), 'compile_error!("poisoned source");');
    writeFileSync(join(source, 'registry/src/.cargo-ok'), '{"v":1}');
    privateRegistryDownloads(source, destination);
    assert.equal(existsSync(join(destination, 'registry/src')), false);
    for (const name of ['cache', 'index']) assert.equal(realpathSync(join(destination, 'registry', name)), join(source, 'registry', name));
  } finally { rmSync(root, {recursive: true}); }
});

test('fresh Git source cannot import a poisoned caller checkout or Git configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'portable-git-test-'));
  try {
    const source = join(root, 'source'), destination = join(root, 'private');
    const database = join(source, 'git/db/hologram-ab6b9bff1a591920');
    mkdirSync(join(database, 'objects/pack'), {recursive: true});
    mkdirSync(join(source, 'git/checkouts/hologram/poisoned'), {recursive: true});
    writeFileSync(join(source, 'git/checkouts/hologram/poisoned/lib.rs'), 'compile_error!("poisoned checkout");');
    writeFileSync(join(database, 'config'), '[core]\nhooksPath=/poisoned/hooks\n');
    const fresh = privateGitObjects(source, destination);
    assert.equal(readFileSync(join(fresh, 'config'), 'utf8').includes('poisoned'), false);
    assert.equal(snapshotSourceTree(destination).some(row => row.path.includes('checkouts')), false);
    writeFileSync(join(database, 'objects/pack/poisoned'), 'different objects');
    assert.equal(snapshotSourceTree(join(fresh, 'objects')).some(row => row.path.includes('poisoned')), false);
  } finally { rmSync(root, {recursive: true}); }
});

test('staged upstream tree permits pinned icon names but rejects source substitution', () => {
  const root = mkdtempSync(join(tmpdir(), 'portable-source-test-'));
  try {
    writeFileSync(join(root, 'icon@2x.png'), 'pinned icon');
    writeFileSync(join(root, 'main.rs'), 'fn main() {}');
    const pinned = snapshotSourceTree(root);
    assert.deepEqual(snapshotSourceTree(root), pinned);
    writeFileSync(join(root, 'main.rs'), 'fn main() { panic!(); }');
    assert.notDeepEqual(snapshotSourceTree(root), pinned);
  } finally { rmSync(root, {recursive: true}); }
});

test('private Cargo home cannot hide a planted ancestor wrapper configuration', () => {
  const parent = mkdtempSync(join(tmpdir(), 'portable-cargo-test-'));
  try {
    const work = join(parent, 'work');
    mkdirSync(work);
    refuseCargoAncestorConfiguration(work);
    mkdirSync(join(parent, '.cargo'));
    for (const name of ['config', 'config.toml']) {
      const path = join(parent, '.cargo', name);
      writeFileSync(path, '[build]\nrustc-wrapper = "/planted/wrapper"\n');
      assert.throws(() => refuseCargoAncestorConfiguration(work), /ancestor configuration/);
      rmSync(path);
    }
  } finally { rmSync(parent, {recursive: true}); }
});

test('verified model, archive and Wasm custody reject between-case substitution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'portable-custody-test-'));
  try {
    for (const name of ['model.prism.json', 'Calculator.holo', 'core.wasm']) {
      const path = join(directory, name);
      writeFileSync(path, 'verified bytes');
      const original = capture(path);
      original.verify();
      writeFileSync(path + '.replacement', 'verified bytes');
      renameSync(path + '.replacement', path);
      assert.throws(original.verify, /custody changed/);
      const replacement = capture(path);
      writeFileSync(path, 'different bytes');
      assert.throws(replacement.verify, /custody changed/);
    }
  } finally { rmSync(directory, {recursive: true}); }
});

test('wrong-status and unrelated assertion cannot stand in for envelope or count checks', () => {
  for (const name of ['wrong-response', 'delayed-wrong-response', 'duplicate', 'delayed-duplicate']) {
    const intended = name.includes('response') ? 'response-envelope' : 'single-invocation';
    requireBoundaryCheck(name, {check: intended});
    for (const check of [null, 'response-status', 'request-envelope', 'response-json'])
      assert.throws(() => requireBoundaryCheck(name, {check}), {code: 'PORTABLE_WRONG_CHECK'});
  }
});

test('process owner reaps detached stubborn descendants on exit, timeout, signal and output limit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'portable-owner-test-'));
  try {
    for (const mode of ['exit', 'timeout', 'signal', 'output']) {
      const timeout = mode === 'timeout';
      const receipt = join(directory, `${mode}.json`);
      const pidFile = join(directory, `${mode}.pid`);
      const child = 'import os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); '
        + `open(${JSON.stringify(pidFile)},"x").write(str(os.getpid())); time.sleep(60)`;
      const parent = 'import subprocess,time,os,signal; '
        + `subprocess.Popen(["/usr/bin/python3","-c",${JSON.stringify(child)}],start_new_session=True); `
        + 'time.sleep(0.2); '
        + (mode === 'signal' ? 'os.kill(os.getppid(),signal.SIGTERM); time.sleep(60)'
          : mode === 'output' ? 'os.write(1,b"x"*2000000); time.sleep(60)'
            : `time.sleep(${timeout ? 60 : 0})`);
      const result = spawnSync('/usr/bin/python3', ['-I', '-B',
        new URL('./portable-oracle-process-owner.py', import.meta.url).pathname,
        '1', receipt, '/usr/bin/python3', '-c', parent], {timeout: 8000, maxBuffer: 65536, encoding: 'utf8'});
      if (mode === 'output') assert.equal(result.error?.code, 'ENOBUFS');
      else {
        assert.ifError(result.error);
        assert.equal(result.status, timeout ? 124 : mode === 'signal' ? 125 : 0, result.stderr);
      }
      const actual = JSON.parse(readFileSync(receipt));
      assert.deepEqual(actual, {
        schema: 'prismpm/portable-process-owner/1', exit_code: timeout ? null : 0,
        timed_out: timeout, interrupted: false, cleanup_verified: true,
        ...(['signal', 'output'].includes(mode) ? {exit_code: actual.exit_code, interrupted: true} : {}),
      });
      const pid = Number(readFileSync(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
    }
  } finally { rmSync(directory, {recursive: true}); }
});

test('portable oracle owns the complete two-profile and two-trigger boundary inventory', () => {
  assert.equal(matrix.schema, 'prismpm/portable-oracle-matrix/1');
  assert.deepEqual(matrix.profiles.map(row => [row.name, row.profile, row.project, row.cargo_name]), [
    ['Calculator', 'legacy-numeric', 'examples/Calculator', 'prism-calculator'],
    ['Text Request', 'utf8-text', 'tests/fixtures/holo/ho-11-text-application/project', 'prism-text-request'],
  ]);
  assert.deepEqual(matrix.triggers, ['click', 'keyboard']);
  assert.deepEqual(matrix.interaction_cases, ['positive', 'delayed-completion', 'stuck-busy', 'missing-control',
    'body-unavailable', 'method-rewrite', 'wrong-response', 'fill-failure', 'private-method', 'body-plus-cleanup',
    'wrong-method', 'wrong-payload', 'duplicate', 'navigation', 'trigger-failure',
    'delayed-duplicate', 'delayed-wrong-response', 'delayed-stuck-busy']);
  assert.deepEqual(matrix.infrastructure_cases, ['pretend-body-failure', 'cleanup-failure', 'setup-failure']);
  assert.equal(matrix.profiles.length * (matrix.triggers.length * matrix.interaction_cases.length + matrix.infrastructure_cases.length), 78);
  assert.deepEqual(matrix.profiles[0].vector_indexes, Array.from({length: 15}, (_, index) => index));
  assert.deepEqual(matrix.profiles[1].vector_indexes, [0, 2, 3]);
  const common = ['attachment-assets', 'modeled-vectors', 'input-validation-recovery',
    'transport-failure-recovery', 'pre-init-privacy', 'delayed-init', 'intent-boundaries'];
  assert.deepEqual(matrix.profiles[0].journeys, [...common, 'detached-session']);
  assert.deepEqual(matrix.profiles[1].journeys, [...common, 'text-response-bounds', 'text-safe-rendering', 'detached-session']);
});

test('the existing interoperability binary owns both complete acceptances and one fresh matrix', () => {
  const rust = read('crates/prismpm/tests/hologram_interop.rs');
  assert.match(rust, /#\[test\]\s+fn test_portable_view_profiles_and_owned_failure_matrix\(\)/);
  for (const name of ['calculator_hologram_oracle_interoperability_acceptance', 'text_application_hologram_oracle_interoperability_acceptance']) {
    assert.equal(rust.split(`fn ${name}()`).length, 2);
    assert.equal(rust.split(`= ${name}();`).length, 2);
  }
  assert.equal(rust.split('scripts/portable-oracle-matrix.mjs').length, 2);
  assert.equal(rust.split('#[test]').length - 1, 3, 'source pin, report negatives and both-profile matrix owners remain unconditional');
  assert.equal(/#\[(?:ignore|cfg|cfg_attr)/.test(rust), false);
  const owner = read('scripts/portable-oracle-matrix.mjs');
  assert(owner.includes(`assert.equal(matrix.interaction_cases.length, ${matrix.interaction_cases.length});`));
  assert(owner.includes(`assert.equal(new Set([...matrix.interaction_cases, ...matrix.infrastructure_cases]).size, ${matrix.interaction_cases.length + matrix.infrastructure_cases.length});`));
  assert.equal(owner.split("run('fresh-compiler'").length, 2);
  assert.match(owner, /'build', '--locked', '--offline'/);
  assert.match(owner, /assert\.equal\(outcomes\.length, 78/);
  assert.match(owner, /executable\.verify\(\)/);
});

test('portable probe rejects undeclared triggers and infrastructure keyboard claims before opening inputs', () => {
  for (const [name, trigger, message] of [['positive', 'unknown', /closed trigger/],
    ['setup-failure', 'keyboard', /do not claim keyboard execution/], ['unknown', 'click', /closed case/]]) {
    const result = spawnSync(process.execPath, [new URL('./portable-oracle-submission-probe.mjs', import.meta.url).pathname,
      '/not-opened', '/not-opened', '/not-opened', name, '/not-created', trigger],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});
