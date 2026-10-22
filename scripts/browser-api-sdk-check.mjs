// Release test input binding, not a release receipt or replacement for source V&V.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,readSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,parse,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {verifyAccountGenesisConstruction} from '../sdk/account-genesis-artifact.mjs';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';

export const sourceRoots=Object.freeze([
 '.cargo','Cargo.toml','Cargo.lock','rust-toolchain.toml','lean-toolchain','LICENSE-MIT','LICENSE-APACHE','SPEC.md','features/suites/sdk.feature','features/suites/stdlib.feature','features/suites/holo.feature','model','language',
 'stdlib/src','sdk/browser','sdk/oracles/package.json','sdk/oracles/package-lock.json','sdk/stdlib-sources.tar','sdk/devcontainer-init.sh','sdk/Dockerfile',
 'tests/browser-workspace','tests/browser-envelope','tests/browser-journal',
 'tests/browser-command','tests/browser-query','tests/browser-api','tests/browser-view',
 'tests/browser-effects','tests/browser-presentation','tests/browser-custody','tests/browser-operation-journal',
 'tests/browser-session','tests/browser-signed-context','tests/browser-account-genesis','tests/browser-p256','tests/browser-pkce',
 'tests/holo-primary-component','tests/hologram-oracle','vendor/hologram-live.tar',
 'tests/browser-budget','tests/browser-contextual-effects','tests/browser-semantic-presentation','tests/browser-dynamic-choice',
 'tests/browser-session-journal','tests/browser-session-journal-retention','tests/browser-session-journal-recovery',
 'tests/browser-session-payloads','tests/browser-session-operation','tests/browser-session-recovery-frames','tests/publication-context-linkage','tests/publication-admission',
 'tests/fixtures/library/native-library/project',
 'tests/support/browser_application.rs','tests/fixtures/holo/ho-11-text-application/project',
 'crates/prismpm/src/holo/browser_application.rs','crates/prismpm/src/holo/browser_application',
 'crates/prismpm/src/browser_build.rs','crates/prismpm/src/browser_build','crates/prismpm/src/lifecycle.rs',
 'crates/conformance/src/cases/browser_compiler.rs','crates/conformance/tests/conformance.rs',
 'crates/conformance/src/cases/mod.rs','crates/conformance/src/cases/scheduling.rs',
 'crates/conformance/src/cases/node_suite.rs','schemas/model-document-v4.schema.json',
 'xtask/src/main.rs',
 'vendor/lexlean','vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust',
 'scripts/browser-api-sdk-check.mjs','scripts/browser-api-sdk-check.test.mjs','scripts/browser-api-sdk-check.sh','scripts/owning-node-reporter.mjs',
 'scripts/sdk-command-owner.mjs','scripts/sdk-command-owner.py',
 'scripts/sdk-qualification-trust.mjs',
 'scripts/fetch-oracle-cargo.sh','sdk/generate-inventory.mjs',
 'sdk/account-genesis-artifact.mjs','sdk/generate-account-genesis.mjs',
]);
// These installed host primitives include private prerequisites, not a public
// browser application runtime. DK-26/27 are pure kernels, not host modules.
// DK-37 extends the existing private effects module, not that public runtime.
// DK-21/22 retain their full installed-V&V owners.
export const hostModules=Object.freeze(['identity','store','peer','journal','commands','queries',
 'view-host','view-dom','view-error','rs256','effects','effects-wire','effects-module',
 'presentation-wire','presentation-dom','semantic-presentation-wire','semantic-presentation-style',
 'credential-custody','operation-journal','account-genesis','account-genesis-binding','signed-context',
 'session-retention-wire','session-storage','session-payloads','session-operation-capture','pkce']);
export const hostArtifacts=Object.freeze(['account-genesis.wasm']);
export const suites=Object.freeze([
 {id:'DK-07',minimum:15,files:['identity.test.mjs','identity.browser.test.mjs']},
 {id:'DK-08',minimum:14,files:['store.test.mjs','boundary.test.mjs']},
 {id:'DK-09',minimum:24,files:['peer.test.mjs']},
 {id:'DK-10',minimum:6,files:['workspace-model-test.mjs']},
 {id:'DK-11',minimum:6,files:['envelope-model-test.mjs']},
 {id:'DK-12',minimum:13,files:['journal-model-test.mjs']},
 {id:'DK-13',minimum:12,files:['command-model-test.mjs']},
 {id:'DK-14',minimum:11,files:['query-model-test.mjs']},
 {id:'DK-15',minimum:47,files:['view-model-test.mjs','tests/browser-view/compiler-artifact.test.mjs','tests/browser-view/compiler-artifact-mutations.test.mjs','tests/browser-view/compiler-owner.test.mjs','tests/browser-view/compiler-runtime.test.mjs','tests/browser-view/compiler-runtime-mutations.test.mjs']},
 {id:'DK-16',minimum:10,files:['view-host-test.mjs']},
 {id:'DK-19',minimum:14,files:['rs256.test.mjs','rs256.browser.test.mjs']},
 {id:'DK-20',minimum:18,files:['effects-wire.test.mjs','effects-module.test.mjs','effects-test.mjs']},
 {id:'DK-23',minimum:39,files:['tests/browser-presentation/wire.test.mjs','tests/browser-presentation/dom.test.mjs','tests/browser-presentation/replay.test.mjs','tests/browser-presentation/provenance.test.mjs','presentation.test.mjs']},
 {id:'DK-24',minimum:28,files:['operation-journal.test.mjs']},
 {id:'DK-25',minimum:11,files:['credential-custody-test.mjs']},
 {id:'DK-26',minimum:39,files:['session-model-test.mjs','tests/browser-session/wire.test.mjs','tests/browser-session/provenance.test.mjs']},
 {id:'DK-27',minimum:13,files:['budget-model-test.mjs']},
 {id:'DK-31',minimum:8,files:['tests/browser-dynamic-choice/wire.test.mjs','tests/browser-dynamic-choice/component.test.mjs','dynamic-choice.test.mjs']},
 {id:'DK-32',minimum:21,files:['tests/browser-signed-context/corpus.test.mjs','tests/browser-signed-context/bridge.test.mjs','tests/browser-signed-context/wpt.test.mjs','tests/browser-signed-context/aggregate.test.mjs','signed-context-test.mjs']},
 {id:'DK-33',minimum:17,files:['tests/browser-account-genesis/corpus.test.mjs','tests/browser-account-genesis/bridge.test.mjs','tests/browser-account-genesis/owner.test.mjs']},
 {id:'DK-34',minimum:22,files:['tests/browser-p256/oracles.test.mjs','tests/browser-p256/corpus.test.mjs','tests/browser-p256/bridge.test.mjs','tests/browser-p256/owner.test.mjs','tests/browser-view/local-module-inputs.test.mjs']},
 {id:'DK-35',minimum:97,files:['tests/browser-session-operation/boundary.test.mjs','tests/browser-view/kernel-provenance.test.mjs','tests/browser-view/local-module-inputs.test.mjs','tests/browser-view/file-custody.test.mjs','tests/browser-session-operation/owner.test.mjs']},
 {id:'DK-37',minimum:24,files:['contextual-effects.test.mjs']},
 {id:'DK-38',minimum:29,files:['tests/browser-semantic-presentation/wire.test.mjs','tests/browser-semantic-presentation/dom.test.mjs','semantic-presentation.test.mjs']},
 {id:'ST-17',minimum:21,files:['tests/browser-pkce/guards.test.mjs','tests/browser-pkce/owner.test.mjs']},
 {id:'HO-15',minimum:11,files:['tests/holo-primary-component/component.test.mjs','tests/holo-primary-component/owner.test.mjs']},
].map(row=>Object.freeze({...row,
 deadline:row.id==='DK-35'?7200000:['DK-15','DK-16','DK-20','DK-23','DK-24','DK-25','DK-26','DK-27','DK-31','DK-32','DK-33','DK-34','DK-37','DK-38','ST-17','HO-15'].includes(row.id)?3600000:1500000,
 files:Object.freeze(row.files.map(file=>file.startsWith('tests/')?file:'sdk/browser/'+file))})));
// Separate executions qualify independent compiler construction without
// replacing shared-owner coverage or enlarging either file's deadline.
export const fallbackSuites=Object.freeze([
 {id:'DK-24',construction:'independent',minimum:28,deadline:3600000,files:['tests/browser-operation-journal/fallback-owner.test.mjs']},
 {id:'DK-27',construction:'independent',minimum:12,deadline:3600000,files:['tests/browser-budget/fallback-owner.test.mjs']},
].map(row=>Object.freeze({...row,files:Object.freeze(row.files)})));
// These original standalone file pairs are additional executions, not
// replacements for DK owners or either fixed-null compiler fallback.
export const standaloneSuites=Object.freeze([
 {id:'Session Projection',deadline:3600000,files:['tests/browser-session-journal/projection.test.mjs','tests/browser-session-journal/projection-owner.test.mjs'],exactTests:[7,1]},
 {id:'Session Reservation',deadline:3600000,files:['tests/browser-session-journal/reservation.test.mjs','tests/browser-session-journal/reservation-owner.test.mjs'],exactTests:[10,23]},
 {id:'Session Payload',deadline:3600000,files:['tests/browser-session-payloads/component.test.mjs','tests/browser-session-payloads/owner.test.mjs'],exactTests:[4,30]},
 {id:'Session Recovery Frames',deadline:3600000,files:['tests/browser-session-recovery-frames/wire.test.mjs','tests/browser-session-recovery-frames/owner.test.mjs'],exactTests:[3,1]},
 {id:'Session Journal Recovery',deadline:5500000,files:['tests/browser-session-journal-recovery/component.test.mjs','tests/browser-session-journal-recovery/owner.test.mjs'],exactTests:[7,1]},
 {id:'Session Retention',deadline:3600000,files:['tests/browser-session-journal-retention/component.test.mjs','tests/browser-session-journal-retention/owner.test.mjs'],exactTests:[4,18]},
].map(row=>Object.freeze({...row,minimum:row.exactTests.reduce((a,b)=>a+b,0),
 files:Object.freeze(row.files),exactTests:Object.freeze(row.exactTests)})));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=(value,names)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),names.slice().sort());};
const hex=(value,width)=>{assert.equal(typeof value,'string');assert.match(value,new RegExp('^[0-9a-f]{'+width+'}$'));};
function boundedBytes(path,before){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const first=fstatSync(fd);assert.ok(first.isFile()&&first.size<=64*1024*1024,'bounded regular source '+path);
  assert.equal(first.dev,before.dev);assert.equal(first.ino,before.ino);assert.equal(first.size,before.size);
  const bytes=Buffer.alloc(first.size+1);let size=0;
  while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  const after=fstatSync(fd),named=lstatSync(path);
  for(const stat of[after,named]){assert.ok(stat.isFile()&&!stat.isSymbolicLink());for(const key of['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(stat[key],first[key],'source changed '+path);}
  assert.equal(size,first.size);return bytes.subarray(0,size);
 }finally{closeSync(fd);}
}

export function capture(root,revision){
 hex(revision,40);root=resolve(root);const files=[];
 function walk(relative){
  const path=join(root,relative),stat=lstatSync(path);assert.ok(!stat.isSymbolicLink(),'source symlink '+relative);
  if(stat.isDirectory()){
   for(const name of readdirSync(path).sort()){
    // Only generated root caches, never nested ordinary source directories.
    if(sourceRoots.includes(relative)&&['target','.lake','.lexlean','.prism'].includes(name))continue;
    walk(relative+'/'+name);
   }
  }else{
   assert.ok(stat.isFile()&&stat.size<=64*1024*1024,'bounded regular source '+relative);
   const bytes=boundedBytes(path,stat);
   files.push({path:relative,size:bytes.length,sha256:hash(bytes)});
  }
 }
 for(const path of sourceRoots){
  let parent=root;assert.ok(lstatSync(parent).isDirectory()&&!lstatSync(parent).isSymbolicLink());
  for(const part of path.split('/').slice(0,-1)){parent=join(parent,part);const stat=lstatSync(parent);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'source parent alias '+parent);}
  walk(path);
 }
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 assert.equal(new Set(files.map(row=>row.path)).size,files.length);
 return{revision,files};
}

export function verifySource(root,expected){
 keys(expected,['revision','files']);hex(expected.revision,40);assert.ok(Array.isArray(expected.files));
 for(const row of expected.files){keys(row,['path','size','sha256']);assert.equal(typeof row.path,'string');hex(row.sha256,64);assert.ok(Number.isSafeInteger(row.size)&&row.size>=0);}
 assert.deepEqual(capture(root,expected.revision),expected,'exact current source and installed SDK compiler/test closure');
}

export function verifyModules(root,installed){
 const names=[...hostModules.map(name=>name+'.mjs'),...hostArtifacts];
 const sources=selectedFiles(resolve(root),names.map(name=>'sdk/browser/'+name));
 const actual=selectedFiles(resolve(installed),names);
 assert.deepEqual(readdirSync(installed).sort(),names.slice().sort(),'exact installed host module closure');
 for(let index=0;index<names.length;index++){
  assert.deepEqual(boundedBytes(actual[index],lstatSync(actual[index])),
   boundedBytes(sources[index],lstatSync(sources[index])),'installed host module bytes: '+names[index]);
 }
}

export function verifyImage(value,image,architecture,revision){
 assert.equal(typeof image,'string');assert.match(image,/^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/);
 assert.ok(['amd64','arm64'].includes(architecture));hex(revision,40);
 assert.ok(Array.isArray(value)&&value.length===1);const config=value[0];
 assert.equal(config.Os,'linux');assert.equal(config.Architecture,architecture);
 assert.ok(Array.isArray(config.RepoDigests)&&config.RepoDigests.every(value=>typeof value==='string')&&config.RepoDigests.includes(image),'exact pulled immutable image reference');
 assert.deepEqual(config.Config.Entrypoint,['/usr/local/bin/prismpm-devcontainer-init']);
 const volumes=config.Config.Volumes;
 assert.ok(volumes===null||volumes===undefined||typeof volumes==='object'&&!Array.isArray(volumes)&&Object.keys(volumes).length===0,'no image-declared writable volumes');
 assert.equal(config.Config.Labels['org.opencontainers.image.revision'],revision);
 assert.equal(config.Config.Labels['org.opencontainers.image.source'],'https://github.com/UOR-Foundation/PrismPM');
 assert.equal(config.Config.Labels['org.opencontainers.image.version'],'0.3.0');
}

export function verifyTap(tap,minimum){
 assert.equal(typeof tap,'string');assert.ok(Number.isSafeInteger(minimum)&&minimum>0);
 const lines=tap.split(/\r?\n/);assert.equal(lines.filter(line=>line==='TAP version 13').length,1,'one TAP document');
 const count=name=>{const rows=lines.filter(line=>line.startsWith('# '+name+' '));assert.equal(rows.length,1,'missing or duplicate '+name+' summary');const raw=rows[0].slice(name.length+3);assert.match(raw,/^(?:0|[1-9][0-9]*)$/);const number=Number(raw);assert.ok(Number.isSafeInteger(number));return number;};
 const tests=count('tests');assert.ok(tests>=minimum,'incomplete test suite');assert.equal(count('pass'),tests,'incomplete pass set');
 for(const name of['fail','cancelled','skipped','todo'])assert.equal(count(name),0,name+' cannot satisfy acceptance');
 assert.equal(count('suites'),0,'unexpected suite wrapper');
 assert.ok(!/^\s*not ok(?: |$)/m.test(tap),'negative TAP row');
 assert.ok(!/^\s*ok\b[^\n]*#\s*(?:SKIP|TODO)\b/im.test(tap),'skipped/TODO TAP row');
 const plans=lines.filter(line=>/^1\.\./.test(line));assert.equal(plans.length,1,'one outer plan');
 const match=/^1\.\.([1-9][0-9]*)$/.exec(plans[0]);assert.ok(match);const top=lines.filter(line=>/^ok [1-9][0-9]* - /.test(line));assert.equal(top.length,Number(match[1]),'complete outer test plan');
 assert.deepEqual(top.map(line=>Number(/^ok ([0-9]+)/.exec(line)[1])),Array.from({length:top.length},(_,index)=>index+1),'complete sequential outer test numbering');
 return tests;
}

function selectedFiles(root, files) {
 assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 64);
 assert.equal(new Set(files).size, files.length, 'duplicate selected test file');
 const absolute = files.map(file => {
  assert.equal(typeof file, 'string');
  assert.ok(file.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part)
   && part !== '.' && part !== '..'), 'closed relative test file');
  return join(root, file);
 });
 for (const file of absolute) {
  let current = parse(file).root;
  const parts = file.slice(current.length).split('/');
  for (let index = 0; index < parts.length; index++) {
   current = join(current, parts[index]);
   const metadata = lstatSync(current);
   assert.ok(!metadata.isSymbolicLink(), 'selected test path alias ' + current);
   assert.ok(index === parts.length - 1 ? metadata.isFile() : metadata.isDirectory(),
    'selected regular test file and directory parents ' + current);
  }
 }
 return absolute;
}

export function verifyFileCompletions(tap, files, total, exactTests) {
 if(exactTests!==undefined){
  assert(Array.isArray(exactTests)&&exactTests.length===files.length);
  assert(exactTests.every(count=>Number.isSafeInteger(count)&&count>0));
 }
 const prefix = '# prismpm-owning-file ';
 const rows = tap.split(/\r?\n/).filter(line => line.startsWith(prefix))
  .map(line => {
   const raw = line.slice(prefix.length), row = JSON.parse(raw);
   assert.equal(JSON.stringify(row), raw, 'exact non-duplicate file completion JSON');
   return row;
  });
 assert.equal(rows.length, files.length, 'complete selected test file summaries');
 let count = 0;
 for (const row of rows) {
  keys(row, ['file', 'success', 'tests', 'passed', 'failed', 'cancelled', 'skipped',
   'todo', 'topLevel', 'suites']);
  assert.equal(typeof row.file, 'string');
  assert.equal(row.success, true, 'successful selected test file');
  for (const field of ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'topLevel', 'suites']) {
   assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0, 'bounded file test count');
  }
  assert.ok(row.tests > 0 && row.topLevel > 0 && row.topLevel <= row.tests,
   'nonempty registered tests in every selected file');
  assert.equal(row.passed, row.tests, 'complete selected file pass set');
  if(exactTests!==undefined)assert.equal(row.tests,exactTests[files.indexOf(row.file)],'exact original standalone file test count');
  for (const outcome of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(row[outcome], 0);
  count += row.tests;
  assert.ok(Number.isSafeInteger(count));
 }
 assert.deepEqual(rows.map(row => row.file).sort(), files.slice().sort(), 'exact selected file completions');
 assert.equal(count, total, 'file completions match complete TAP test count');
}

async function launchSuite(program,args,options){
 if(!options.owned)return spawnSync(program,args,options);
 const result=await executeOwnedSdkCommand(program,args,{profile:'qualification',cwd:options.cwd,
  environment:options.env,timeout:options.timeout,limit:options.maxBuffer,interruptions:true});
 try{
  for(const outcome of ['timedOut','overflow','aborted','orphaned'])assert.equal(result[outcome],false,'standalone '+outcome);
  assert.equal(result.retirement.descendants_absent,true,'standalone owned descendant exhaustion');
  assert.equal(result.retirement.supervisor_status,0);assert.equal(result.retirement.supervisor_signal,null);
  assert.equal(result.retirement.uncertainty,null);assert.equal(result.retirement.protocol_failure,null);
 }catch(error){error.result=result;throw error;}
 return {status:result.status,signal:result.signal,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')};
}

async function runSuiteCollection(root,executions,launch,emit){
 root=resolve(root);
 // Preflight the complete inventory before any test can execute. The installed
 // SDK separately binds these immutable source bytes; this is not a race lock.
 const identity=suite=>suite.id+(suite.construction?' '+suite.construction:'');
 assert.equal(new Set(executions.map(identity)).size,executions.length,'unique compiler construction owners');
 assert.ok(fallbackSuites.every(row=>suites.some(suite=>suite.id===row.id)),'independent owner has an original capability');
 const selected=new Map(executions.map(suite=>[identity(suite),selectedFiles(root,suite.files)]));
 const reporter='data:text/javascript;base64,'+readFileSync(new URL('./owning-node-reporter.mjs',import.meta.url)).toString('base64');
 const completed=[],env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const execution of executions){
  const deadline=execution.deadline;
  const args=['--test','--test-concurrency=1','--test-reporter='+reporter,'--test-timeout='+deadline,...execution.files];
  let output;
  try{
   output=await launch(process.execPath,args,{cwd:root,encoding:'utf8',timeout:execution.exactTests?deadline:deadline+100000,maxBuffer:64*1024*1024,env,...(execution.exactTests?{owned:true}:{})});
  }catch(error){
   emit('SDK browser suite '+identity(execution)+'\n'+(error.result?.stdout??'')+(error.result?.stderr??''));
   throw error;
  }
  emit('SDK browser suite '+identity(execution)+'\n'+(output.stdout??'')+(output.stderr??''));
  assert.equal(output.error,undefined);assert.equal(output.signal,null);assert.equal(output.status,0,'complete owning '+identity(execution));
  const tests=verifyTap(output.stdout,execution.minimum);
  verifyFileCompletions(output.stdout,selected.get(identity(execution)),tests,execution.exactTests);
  completed.push({id:execution.id,...(execution.construction?{construction:execution.construction}:{}),tests});
 }
 assert.deepEqual(completed.map(identity),executions.map(identity));return completed;
}

// Invoked only in the inspected current SDK. Preserve the original26 owners
// and both independent fallbacks, then execute all six complete file pairs.
export async function runSuites(root,launch=launchSuite,emit=text=>process.stdout.write(text)){
 return runSuiteCollection(root,[...suites,...fallbackSuites,...standaloneSuites],launch,emit);
}

// Source VV has already executed the original registered DK/fallback owners.
// Its separate standalone invocation still executes every original file pair.
export async function runStandaloneSuites(root,launch=launchSuite,emit=text=>process.stdout.write(text)){
 return runSuiteCollection(root,standaloneSuites,launch,emit);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[mode,...args]=process.argv.slice(2);
 if(mode==='roots'&&args.length===0)console.log(sourceRoots.join('\n'));
 else if(mode==='account-construction'&&args.length===2) {
   const snapshot=JSON.parse(readFileSync(args[1],'utf8'));
   keys(snapshot,['revision','files']);hex(snapshot.revision,40);
   assert(Array.isArray(snapshot.files)&&snapshot.files.length>0);
   for(const row of snapshot.files){keys(row,['path','size','sha256']);hex(row.sha256,64);}
   const expected=Object.fromEntries(snapshot.files.map(row=>[row.path,row.sha256]));
   assert.equal(Object.keys(expected).length,snapshot.files.length);
   verifyAccountGenesisConstruction(args[0],expected);
 }
 else if(mode==='modules'&&args.length===2)verifyModules(...args);
 else if(mode==='capture'&&args.length===2)console.log(JSON.stringify(capture(...args)));
 else if(mode==='verify'&&args.length===2)verifySource(args[0],JSON.parse(readFileSync(args[1])));
 else if(mode==='image'&&args.length===3)verifyImage(JSON.parse(readFileSync(0)),...args);
 else if(mode==='run'&&args.length===0)console.log(JSON.stringify(await runSuites(resolve(dirname(fileURLToPath(import.meta.url)),'..'))));
 else if(mode==='standalone'&&args.length===0)console.log(JSON.stringify(await runStandaloneSuites(resolve(dirname(fileURLToPath(import.meta.url)),'..'))));
 else throw Error('closed browser SDK test binding command');
}
