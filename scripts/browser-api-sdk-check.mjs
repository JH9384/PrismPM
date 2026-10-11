// Release test input binding, not a release receipt or replacement for source V&V.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,readSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,parse,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';

export const sourceRoots=Object.freeze([
 '.cargo','Cargo.toml','Cargo.lock','rust-toolchain.toml','lean-toolchain','LICENSE-MIT','LICENSE-APACHE','SPEC.md','features/suites/sdk.feature','model','language',
 'stdlib/src','sdk/browser','sdk/stdlib-sources.tar','sdk/devcontainer-init.sh','sdk/Dockerfile',
 'tests/browser-workspace','tests/browser-envelope','tests/browser-journal',
 'tests/browser-command','tests/browser-query','tests/browser-api','tests/browser-view',
 'tests/browser-effects','tests/browser-presentation','tests/browser-custody','tests/browser-operation-journal',
 'tests/browser-session',
 'tests/fixtures/library/native-library/project',
 'tests/support/browser_application.rs','tests/fixtures/holo/ho-11-text-application/project',
 'crates/prismpm/src/holo/browser_application.rs','crates/prismpm/src/holo/browser_application',
 'crates/prismpm/src/browser_build.rs','crates/prismpm/src/browser_build',
 'crates/conformance/src/cases/browser_compiler.rs','crates/conformance/tests/conformance.rs',
 'crates/conformance/src/cases/mod.rs','schemas/model-document-v4.schema.json',
 'vendor/lexlean','vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust',
 'scripts/browser-api-sdk-check.mjs','scripts/browser-api-sdk-check.sh','scripts/owning-node-reporter.mjs',
 'scripts/fetch-oracle-cargo.sh','sdk/generate-inventory.mjs',
]);
// These installed host primitives include private prerequisites, not a public
// browser application runtime. DK-21/22 retain their full installed-V&V owners.
export const hostModules=Object.freeze(['identity','store','peer','journal','commands','queries',
 'view-host','view-dom','view-error','rs256','effects','effects-wire','effects-module',
 'presentation-wire','presentation-dom','credential-custody','operation-journal']);
export const suites=Object.freeze([
 {id:'DK-07',minimum:15,files:['identity.test.mjs','identity.browser.test.mjs']},
 {id:'DK-08',minimum:14,files:['store.test.mjs','boundary.test.mjs']},
 {id:'DK-09',minimum:24,files:['peer.test.mjs']},
 {id:'DK-10',minimum:6,files:['workspace-model-test.mjs']},
 {id:'DK-11',minimum:6,files:['envelope-model-test.mjs']},
 {id:'DK-12',minimum:13,files:['journal-model-test.mjs']},
 {id:'DK-13',minimum:12,files:['command-model-test.mjs']},
 {id:'DK-14',minimum:11,files:['query-model-test.mjs']},
 {id:'DK-15',minimum:34,files:['view-model-test.mjs','tests/browser-view/compiler-artifact.test.mjs','tests/browser-view/compiler-artifact-mutations.test.mjs','tests/browser-view/compiler-owner.test.mjs','tests/browser-view/compiler-runtime.test.mjs','tests/browser-view/compiler-runtime-mutations.test.mjs']},
 {id:'DK-16',minimum:10,files:['view-host-test.mjs']},
 {id:'DK-19',minimum:14,files:['rs256.test.mjs','rs256.browser.test.mjs']},
 {id:'DK-20',minimum:18,files:['effects-wire.test.mjs','effects-module.test.mjs','effects-test.mjs']},
 {id:'DK-23',minimum:37,files:['tests/browser-presentation/wire.test.mjs','tests/browser-presentation/dom.test.mjs','tests/browser-presentation/replay.test.mjs','tests/browser-presentation/provenance.test.mjs','presentation.test.mjs']},
 {id:'DK-24',minimum:28,files:['operation-journal.test.mjs']},
 {id:'DK-25',minimum:11,files:['credential-custody-test.mjs']},
 {id:'DK-26',minimum:39,files:['session-model-test.mjs','tests/browser-session/wire.test.mjs','tests/browser-session/provenance.test.mjs']},
].map(row=>Object.freeze({...row,
 deadline:['DK-15','DK-16','DK-20','DK-23','DK-24','DK-25','DK-26'].includes(row.id)?3600000:1500000,
 files:Object.freeze(row.files.map(file=>file.startsWith('tests/')?file:'sdk/browser/'+file))})));
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
 const names=hostModules.map(name=>name+'.mjs');
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
 assert.deepEqual(top.map(line=>Number(/^ok ([0-9]+)/.exec(line)[1])),Array.from({length:top.length},(_,index)=>index+1));
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

export function verifyFileCompletions(tap, files, total) {
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
  for (const outcome of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(row[outcome], 0);
  count += row.tests;
  assert.ok(Number.isSafeInteger(count));
 }
 assert.deepEqual(rows.map(row => row.file).sort(), files.slice().sort(), 'exact selected file completions');
 assert.equal(count, total, 'file completions match complete TAP test count');
}

// Invoked only in the inspected current SDK. Source V&V remains independent.
export function runSuites(root,launch=spawnSync,emit=text=>process.stdout.write(text)){
 root=resolve(root);
 // Preflight the complete inventory before any test can execute. The installed
 // SDK separately binds these immutable source bytes; this is not a race lock.
 const selected=new Map(suites.map(suite=>[suite.id,selectedFiles(root,suite.files)]));
 const reporter='data:text/javascript;base64,'+readFileSync(new URL('./owning-node-reporter.mjs',import.meta.url)).toString('base64');
 const completed=[],env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const suite of suites){
  const deadline=suite.deadline;
  const args=['--test','--test-concurrency=1','--test-reporter='+reporter,'--test-timeout='+deadline,...suite.files];
  const output=launch(process.execPath,args,{cwd:root,encoding:'utf8',timeout:deadline+100000,maxBuffer:64*1024*1024,env});
  emit('SDK browser suite '+suite.id+'\n'+(output.stdout??'')+(output.stderr??''));
  assert.equal(output.error,undefined);assert.equal(output.signal,null);assert.equal(output.status,0,'complete owning '+suite.id);
  const tests=verifyTap(output.stdout,suite.minimum);
  verifyFileCompletions(output.stdout,selected.get(suite.id),tests);
  completed.push({id:suite.id,tests});
 }
 assert.deepEqual(completed.map(row=>row.id),suites.map(row=>row.id));return completed;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[mode,...args]=process.argv.slice(2);
 if(mode==='roots'&&args.length===0)console.log(sourceRoots.join('\n'));
 else if(mode==='modules'&&args.length===2)verifyModules(...args);
 else if(mode==='capture'&&args.length===2)console.log(JSON.stringify(capture(...args)));
 else if(mode==='verify'&&args.length===2)verifySource(args[0],JSON.parse(readFileSync(args[1])));
 else if(mode==='image'&&args.length===3)verifyImage(JSON.parse(readFileSync(0)),...args);
 else if(mode==='run'&&args.length===0)console.log(JSON.stringify(runSuites(resolve(dirname(fileURLToPath(import.meta.url)),'..'))));
 else throw Error('closed browser SDK test binding command');
}
