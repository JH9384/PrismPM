import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync,symlinkSync,openSync,closeSync,ftruncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {test} from 'node:test';
import {capture,verifySource,verifyImage,verifyTap,verifyFileCompletions,runSuites,sourceRoots,suites,fallbackSuites} from './browser-api-sdk-check.mjs';
import * as browserGate from './browser-api-sdk-check.mjs';

const hostModules = ['identity', 'store', 'peer', 'journal', 'commands', 'queries',
 'view-host', 'view-dom', 'view-error', 'rs256', 'effects', 'effects-wire',
 'effects-module', 'presentation-wire', 'presentation-dom', 'semantic-presentation-wire',
 'semantic-presentation-style', 'credential-custody', 'operation-journal','account-genesis','account-genesis-binding','signed-context',
 'session-retention-wire','session-storage','session-payloads','session-operation-capture','pkce'];
const sdkSource = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const additionalOwners = [
 {id:'HO-15',minimum:11,deadline:3600000,files:['tests/holo-primary-component/component.test.mjs','tests/holo-primary-component/owner.test.mjs']},
 {id:'ST-17',minimum:21,deadline:3600000,files:['tests/browser-pkce/guards.test.mjs','tests/browser-pkce/owner.test.mjs']},
 {id:'DK-27',minimum:13,deadline:3600000,files:['sdk/browser/budget-model-test.mjs']},
 {id:'DK-37',minimum:24,deadline:3600000,files:['sdk/browser/contextual-effects.test.mjs']},
 {id:'DK-31',minimum:8,deadline:3600000,files:['tests/browser-dynamic-choice/wire.test.mjs','tests/browser-dynamic-choice/component.test.mjs','sdk/browser/dynamic-choice.test.mjs']},
 {id:'DK-32',minimum:21,deadline:3600000,files:['tests/browser-signed-context/corpus.test.mjs','tests/browser-signed-context/bridge.test.mjs','tests/browser-signed-context/wpt.test.mjs','tests/browser-signed-context/aggregate.test.mjs','sdk/browser/signed-context-test.mjs']},
 {id:'DK-34',minimum:22,deadline:3600000,files:['tests/browser-p256/oracles.test.mjs','tests/browser-p256/corpus.test.mjs','tests/browser-p256/bridge.test.mjs','tests/browser-p256/owner.test.mjs','tests/browser-view/local-module-inputs.test.mjs']},
 {id:'DK-35',minimum:97,deadline:7200000,files:['tests/browser-session-operation/boundary.test.mjs','tests/browser-view/kernel-provenance.test.mjs','tests/browser-view/local-module-inputs.test.mjs','tests/browser-view/file-custody.test.mjs','tests/browser-session-operation/owner.test.mjs']},
];
function registeredAdditionalOwner(source,id) {
 const files=text=>[...text.matchAll(/"([^"]+)"/g)].map(row=>row[1]);
 const direct=new RegExp('"'+id+'"\\s*=>\\s*verify_node_suite\\(\\s*root,\\s*id,\\s*&\\[([\\s\\S]*?)\\],\\s*(\\d+),\\s*"(\\d+)"').exec(source);
 if(direct)return {id,files:files(direct[1]),minimum:Number(direct[2]),deadline:Number(direct[3])};
 const start=source.indexOf('fn verify_browser_host(');assert.ok(start>=0);
 const host=source.slice(start,source.indexOf('\nfn ',start+1));
 const row=new RegExp('"'+id+'"\\s*=>\\s*\\(\\s*&\\[([\\s\\S]*?)\\],\\s*(\\d+)').exec(host);
 assert.ok(row,'actual registered Rust private prerequisite owner '+id);
 const timeout=/let timeout = if matches!\(\s*id,\s*([\s\S]*?)\)\s*\{\s*"(\d+)"\s*\}\s*else if matches!\(\s*id,\s*([\s\S]*?)\)\s*\{\s*"(\d+)"\s*\}\s*else\s*\{\s*"(\d+)"\s*\}/.exec(host);
 assert.ok(timeout,'closed actual Rust owner deadlines');
 assert.match(host,/verify_node_suite\(root, id, files, minimum_tests, timeout\)/);
 return {id,files:files(row[1]),minimum:Number(row[2]),deadline:Number(files(timeout[1]).includes(id)?timeout[2]:files(timeout[3]).includes(id)?timeout[4]:timeout[5])};
}

const independentOwners = [
 {id:'DK-24',construction:'independent',minimum:28,deadline:3600000,files:['tests/browser-operation-journal/fallback-owner.test.mjs']},
 {id:'DK-27',construction:'independent',minimum:12,deadline:3600000,files:['tests/browser-budget/fallback-owner.test.mjs']},
];
function registeredIndependentOwners(source) {
 const start=source.indexOf('_ => panic!("unhandled conformance id: {id}"),');assert.ok(start>=0);
 const tail=source.slice(start,source.indexOf('\nfn verify_browser_host(',start));
 const pattern=/match id \{\s*"(DK-24)" => verify_node_suite\(\s*root,\s*id,\s*&\["([^"]+)"\],\s*(\d+),\s*"(\d+)",\s*\),\s*"(DK-27)" => verify_node_suite\(\s*root,\s*id,\s*&\["([^"]+)"\],\s*(\d+),\s*"(\d+)",\s*\),\s*_ => \{\}\s*\}\s*\}\s*$/;
 const row=pattern.exec(tail);assert.ok(row,'exact separate guarded source fallback calls after original owners');
 return [1,5].map(index=>({id:row[index],construction:'independent',files:[row[index+1]],minimum:Number(row[index+2]),deadline:Number(row[index+3])}));
}

test('independent construction owners are separately registered with unchanged complete files and deadlines',()=>{
 assert.deepEqual(fallbackSuites,independentOwners);
 assert.ok(Object.isFrozen(fallbackSuites));
 for(const owner of fallbackSuites){assert.ok(Object.isFrozen(owner));assert.ok(Object.isFrozen(owner.files));}
 const source=sdkSource('crates/conformance/src/cases/mod.rs');
 assert.deepEqual(registeredIndependentOwners(source),independentOwners);
 const start=source.indexOf('_ => panic!("unhandled conformance id: {id}"),'),prefix=source.slice(0,start),tail=source.slice(start);
 for(const owner of independentOwners){
  for(const changed of [tail.replace(owner.id,owner.id==='DK-24'?'DK-25':'DK-26'),
   tail.replace(owner.files[0],owner.files[0]+'.changed'),
   tail.replace('            '+owner.minimum+',','            '+(owner.minimum-1)+','),
   tail.replace(new RegExp('("'+owner.id+'" => verify_node_suite\\([\\s\\S]*?\\],\\s*'+owner.minimum+',\\s*)"3600000"'),'$1"3600001"'),
   tail.replace(new RegExp('"'+owner.id+'" => verify_node_suite\\([\\s\\S]*?\\),'),''),
   tail.replaceAll('DK-24','SWAP').replaceAll('DK-27','DK-24').replaceAll('SWAP','DK-27')])
   assert.throws(()=>assert.deepEqual(registeredIndependentOwners(prefix+changed),independentOwners));
  assert.ok(sourceRoots.some(root=>owner.files[0].startsWith(root+'/')));
  assert.match(sdkSource(owner.files[0]),/timeout:3500000/);
 }
});

test('operation journal source closure binds every static and admitted dynamic module and guest authority',async()=>{
 const {sourceClosure}=await import('../tests/browser-operation-journal/checks.mjs');
 const root=resolve(import.meta.dirname,'..'),snapshot=sourceClosure();
 const paths=new Set(Object.keys(snapshot).map(path=>(!path.includes('/')&&path.endsWith('.mjs')
  ||path==='runner.rs'||path.startsWith('driver/')||path.startsWith('src/'))?'tests/browser-operation-journal/'+path:path));
 assert.equal(paths.size,Object.keys(snapshot).length,'unique normalized journal source inputs');
 for(const path of paths)assert.ok(sourceRoots.some(root=>path===root||path.startsWith(root+'/')),'installed journal input: '+path);
 const required=new Set();let dynamicCount=0;
 const parser='import{SourceTextModule}from"node:vm";import{readFileSync}from"node:fs";'
  +'console.log(JSON.stringify(new SourceTextModule(readFileSync(0,"utf8")).dependencySpecifiers));';
 const routeSource=sdkSource('tests/browser-operation-journal/browser.mjs');
 const routes=/const names = \[([\s\S]*?)\];/.exec(routeSource);assert.ok(routes);
 const routed=[...routes[1].matchAll(/'([^']+)'/g)].map(row=>row[1]);
 assert.deepEqual(routed,['operation-journal.mjs','effects.mjs','effects-wire.mjs','effects-module.mjs',
  'credential-custody.mjs','identity.mjs','store.mjs','browser-fixture.mjs']);
 assert.match(routeSource,/for \(const name of names\) await page\.route/);
 for(const path of paths){
  // Vendored compiler fixtures are pinned input bytes, not imported JS owners.
  if(!path.endsWith('.mjs')||path.startsWith('vendor/'))continue;
  const bytes=readFileSync(join(root,path)),source=bytes.toString('utf8');
  const parsed=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',parser],
   {input:bytes,encoding:'utf8',timeout:10000,maxBuffer:1048576,env:{NODE_NO_WARNINGS:'1',TZ:'UTC'}});
  assert.equal(parsed.error,undefined);assert.equal(parsed.signal,null);assert.equal(parsed.status,0,parsed.stderr);
  const dependencies=JSON.parse(parsed.stdout);
  const expressions=[...source.matchAll(/\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/g)];
  const literals=[...source.matchAll(/\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)];
  assert.equal(expressions.length,literals.length,'every dynamic import has a closed literal registration: '+path);
  dynamicCount+=literals.length;
  for(const specifier of [...dependencies,...literals.map(row=>row[2])]){
   if(specifier.startsWith('node:'))continue;
   assert.match(specifier,/^\.{1,2}\//);let selected;
   if(path==='tests/browser-operation-journal/browser-fixture.mjs'){
    assert.ok(specifier.startsWith('./')&&routed.includes(specifier.slice(2)),'exact admitted virtual browser route');
    selected='sdk/browser/'+specifier.slice(2);
   }else if(path==='tests/browser-custody/browser-fixture.mjs'){
    assert.ok(['./credential-custody.mjs','./effects-wire.mjs','./identity.mjs'].includes(specifier),'exact admitted custody browser dependency');
    selected='sdk/browser/'+specifier.slice(2);
   }else selected=relative(root,resolve(root,dirname(path),specifier));
   assert.ok(!selected.startsWith('../')&&!selected.startsWith('/'),'dependency stays in repository');required.add(selected);
  }
 }
 assert.equal(dynamicCount,15,'complete explicit journal and custody dynamic-import inventory');
 for(const file of ['tests/browser-workspace/src/main.rs','tests/browser-journal/driver/src/main.rs',
  'sdk/oracles/package.json','sdk/oracles/package-lock.json','LICENSE-MIT','LICENSE-APACHE',
  'tests/browser-custody/browser.mjs','tests/browser-custody/browser-fixture.mjs'])required.add(file);
 const verify=selected=>{for(const file of required)assert.ok(selected.has(file),'omitted effective journal input: '+file);};
 verify(paths);
 for(const file of required){const omitted=new Set(paths);omitted.delete(file);assert.throws(()=>verify(omitted),/omitted effective journal input/);}
});

test('private prerequisites retain exact registered source files minima deadlines and host inventory',()=>{
 const source=sdkSource('crates/conformance/src/cases/mod.rs');
 for(const owner of additionalOwners){
  assert.deepEqual(suites.find(row=>row.id===owner.id),owner,'mandatory installed '+owner.id);
  assert.deepEqual(registeredAdditionalOwner(source,owner.id),owner,'actual source and installed owner agree');
  for(const file of owner.files)assert.ok(sdkSource(file).length,'actual owning file exists');
 }
 assert.deepEqual(browserGate.hostModules,hostModules,'only the exact registered private host modules are installed');
});

test('private prerequisite source closure includes complete fixture directories and shared compiler lifecycle',()=>{
 for(const path of ['tests/browser-budget','tests/browser-contextual-effects','tests/browser-dynamic-choice','tests/browser-signed-context','tests/browser-session-operation','tests/browser-pkce','tests/holo-primary-component','tests/browser-view','stdlib/src'])
  assert.ok(sourceRoots.includes(path),'required installed private prerequisite source '+path);
});

test('installed source roots cover every actual frozen private prerequisite compiler input',async()=>{
 for(const path of ['tests/browser-budget/compile.mjs','tests/browser-contextual-effects/checks.mjs','tests/browser-dynamic-choice/compile.mjs','tests/browser-signed-context/compile.mjs','tests/browser-session-operation/compile.mjs','tests/browser-pkce/compile.mjs','tests/holo-primary-component/compile.mjs','tests/browser-presentation/compile.mjs','tests/browser-session/compile.mjs','tests/browser-semantic-presentation/compile.mjs']){
  const {frozenInputs}=await import(new URL('../'+path,import.meta.url));
  for(const input of Object.keys(frozenInputs()))
   assert.ok(sourceRoots.some(root=>input===root||input.startsWith(root+'/')),'unbound actual private prerequisite input '+input);
 }
});

test('private prerequisite comparisons reject actual registered file minimum and deadline substitutions',()=>{
 const source=sdkSource('crates/conformance/src/cases/mod.rs');
 for(const owner of additionalOwners){
  assert.deepEqual(registeredAdditionalOwner(source,owner.id),owner);
  const minimum=new RegExp('("'+owner.id+'"\\s*=>\\s*(?:verify_node_suite\\(\\s*root,\\s*id,\\s*|\\(\\s*)&\\[[\\s\\S]*?\\],\\s*)'+owner.minimum+'(\\s*[,)])');
  assert.ok(minimum.test(source),'exact registered minimum for '+owner.id);
  const changedMinimum=source.replace(minimum,(_,before,after)=>before+(owner.minimum-1)+after);
  for(const changed of [source.replace(owner.files[0],owner.files[0]+'.changed'),
   changedMinimum,source.replaceAll('"'+owner.deadline+'"','"'+(owner.deadline-1)+'"')])
   assert.throws(()=>assert.deepEqual(registeredAdditionalOwner(changed,owner.id),owner));
 }
});

test('installed module inventory includes every accepted private browser prerequisite without opening the runtime', () => {
 assert.deepEqual(browserGate.hostModules, hostModules);
 assert.deepEqual(browserGate.hostArtifacts, ['account-genesis.wasm']);
 const recipe = sdkSource('sdk/Dockerfile');
 const instruction = recipe.split('\n').find(line => line.startsWith('COPY ') && line.endsWith(' /opt/prismpm/browser/'));
 assert.ok(instruction);
 assert.deepEqual([...instruction.matchAll(/\/prepared\/source\/sdk\/browser\/([a-z0-9-]+)\.mjs/g)].map(row => row[1]), hostModules);
 assert.match(instruction, /--from=source_inputs --chmod=0444/);
 const shell = sdkSource('scripts/browser-api-sdk-check.sh');
 assert.match(shell, /node "\$helper" modules "\$root" "\$sdk_work\/browser"/);
 assert.match(shell, /node "\$helper" account-construction "\$sdk_work"/);
 for (const module of hostModules) assert.ok(sdkSource('sdk/browser/' + module + '.mjs').length);
 assert.ok(sdkSource('sdk/generate-inventory.mjs').includes("['browser-host-primitives', 'adapter', '1', '/opt/prismpm/browser', 'tree']"));
 assert.ok(sdkSource('sdk/generate-inventory.mjs').includes("['browser-account-genesis-construction', 'adapter', '1', '/opt/prismpm/share/account-genesis', 'tree']"));
 assert.equal(recipe.split('node sdk/generate-account-genesis.mjs install').length, 2);
 assert.ok(recipe.indexOf('bash scripts/fetch-oracle-cargo.sh') < recipe.indexOf('node sdk/generate-account-genesis.mjs install'));
 assert.ok(recipe.indexOf('node sdk/generate-account-genesis.mjs install') < recipe.indexOf('cp -a . /opt/prismpm/share/conformance-root/'));
 assert.equal(hostModules.filter(name => name === 'operation-journal').length, 1);
});

test('installed browser closure includes complete new owning fixtures and actual Rust refusal owners', () => {
 for (const path of ['tests/browser-effects', 'tests/browser-presentation', 'tests/browser-custody', 'tests/browser-operation-journal', 'tests/browser-session','tests/browser-account-genesis',
  'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
  'tests/browser-budget', 'tests/browser-contextual-effects','tests/browser-semantic-presentation','tests/browser-dynamic-choice',
  'tests/browser-session-journal','tests/browser-session-journal-retention','tests/browser-session-journal-recovery',
  'tests/browser-session-payloads','tests/browser-session-operation','tests/browser-session-recovery-frames','tests/publication-context-linkage',
  'tests/fixtures/library/native-library/project', 'tests/support/browser_application.rs',
  'crates/prismpm/src/browser_build.rs', 'crates/prismpm/src/browser_build',
  'crates/prismpm/src/holo/browser_application.rs', 'crates/prismpm/src/holo/browser_application',
  'crates/conformance/tests/conformance.rs', 'crates/conformance/src/cases/browser_compiler.rs',
  'scripts/browser-api-sdk-check.sh', 'scripts/fetch-oracle-cargo.sh', 'sdk/generate-inventory.mjs',
  'sdk/account-genesis-artifact.mjs', 'sdk/generate-account-genesis.mjs']) {
  assert.ok(sourceRoots.includes(path), 'required installed source: ' + path);
 }
 const source = sdkSource('crates/conformance/tests/conformance.rs');
 for (const id of [21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38]) assert.ok(source.includes(`test_case!(conformance_dk_${id}, "DK-${id}");`));
 assert.match(sdkSource('crates/prismpm/src/holo/browser_application.rs'), /Err\(PrismError::new\("PP2011"/);
 assert.match(sdkSource('crates/prismpm/src/browser_build/tests.rs'), /assert_eq!\(result.code, "PP2011"\)/);
 const workflow = sdkSource('.github/workflows/release.yml');
 assert.match(workflow, /browser-api-sdk-check\.sh/);
 assert.match(workflow, /bash root-a\/scripts\/sdk-vv-outer\.sh/);
 const launcher = sdkSource('scripts/sdk-vv-outer.sh');
 assert.match(launcher, /node root-a\/scripts\/sdk-vv-check\.mjs tests; node root-a\/scripts\/sdk-vv-check\.mjs run "\$1" "\$2" "\$3" "\$4"/);
 assert.match(launcher, /--target registry_qualification_tools/);
});

test('new installed Node suites retain exact complete owning files and deadlines', () => {
 const effects = suites.find(row => row.id === 'DK-20'), view = suites.find(row => row.id === 'DK-23');
 assert.deepEqual(effects?.files, ['sdk/browser/effects-wire.test.mjs', 'sdk/browser/effects-module.test.mjs', 'sdk/browser/effects-test.mjs']);
 assert.equal(effects?.minimum, 18);
 assert.deepEqual(view?.files, ['tests/browser-presentation/wire.test.mjs', 'tests/browser-presentation/dom.test.mjs', 'tests/browser-presentation/replay.test.mjs', 'tests/browser-presentation/provenance.test.mjs', 'sdk/browser/presentation.test.mjs']);
 assert.equal(view?.minimum, 39);
 const owning = /"DK-23"\s*=>\s*\(\s*&\[([\s\S]*?)\],\s*(\d+),/.exec(sdkSource('crates/conformance/src/cases/mod.rs'));
 assert.ok(owning, 'actual registered Rust owning suite exists');
 assert.equal(Number(owning[2]), view.minimum, 'installed and source-owning minimum agree');
 assert.deepEqual([...owning[1].matchAll(/"([^"]+)"/g)].map(row => row[1]), view.files);
 assert.equal(effects?.deadline, 3600000); assert.equal(view?.deadline, 3600000);
 const custody = suites.find(row => row.id === 'DK-25');
 assert.deepEqual(custody?.files, ['sdk/browser/credential-custody-test.mjs']);
 assert.equal(custody?.minimum, 11); assert.equal(custody?.deadline, 3600000);
 const semantic = suites.find(row => row.id === 'DK-38');
 assert.deepEqual(semantic?.files, ['tests/browser-semantic-presentation/wire.test.mjs', 'tests/browser-semantic-presentation/dom.test.mjs', 'sdk/browser/semantic-presentation.test.mjs']);
 assert.equal(semantic?.minimum, 29); assert.equal(semantic?.deadline, 3600000);
 const journal = suites.find(row => row.id === 'DK-24');
 assert.deepEqual(journal?.files, ['sdk/browser/operation-journal.test.mjs']);
 assert.equal(journal?.minimum, 28); assert.equal(journal?.deadline, 3600000);
 const session = suites.find(row => row.id === 'DK-26');
 assert.deepEqual(session?.files, ['sdk/browser/session-model-test.mjs','tests/browser-session/wire.test.mjs','tests/browser-session/provenance.test.mjs']);
 assert.equal(session?.minimum, 39); assert.equal(session?.deadline, 3600000);
 const sessionOwner = /"DK-26"\s*=>\s*verify_node_suite\(\s*root,\s*id,\s*&\[([^\]]+)\],\s*(\d+),\s*"([0-9]+)"/.exec(sdkSource('crates/conformance/src/cases/mod.rs'));
 assert.ok(sessionOwner, 'actual complete registered session owner');
 assert.deepEqual([...sessionOwner[1].matchAll(/"([^"]+)"/g)].map(row=>row[1]), session.files);
 assert.equal(Number(sessionOwner[2]), session.minimum); assert.equal(Number(sessionOwner[3]), session.deadline);
});

test('installed session kernel preserves its exact registered owner, complete sources and private scope', () => {
 const session = suites.find(row => row.id === 'DK-26');
 assert.ok(session, 'installed DK-26 owner is required');
 assert.deepEqual(session.files, ['sdk/browser/session-model-test.mjs', 'tests/browser-session/wire.test.mjs','tests/browser-session/provenance.test.mjs']);
 assert.equal(session.minimum, 39); assert.equal(session.deadline, 3600000);
 const registered = /"DK-26"\s*=>\s*verify_node_suite\(\s*root,\s*id,\s*&\[([\s\S]*?)\],\s*(\d+),\s*"(\d+)"/.exec(sdkSource('crates/conformance/src/cases/mod.rs'));
 assert.ok(registered, 'actual source owner exists');
 assert.deepEqual([...registered[1].matchAll(/"([^"]+)"/g)].map(row => row[1]), session.files);
 assert.equal(Number(registered[2]), session.minimum);
 assert.equal(Number(registered[3]), session.deadline);
 for (const path of ['tests/browser-session', 'LICENSE-MIT', 'LICENSE-APACHE']) {
  assert.ok(sourceRoots.includes(path), 'complete session compiler input: ' + path);
 }
 assert.ok(sdkSource('crates/conformance/tests/conformance.rs').includes('test_case!(conformance_dk_26, "DK-26");'));
 assert.ok(!browserGate.hostModules.includes('session'), 'pure kernel is not an implemented public session host');
});

test('semantic owner registration preserves actual Rust files, minimum and deadline', () => {
 const semantic = suites.find(row => row.id === 'DK-38');
 assert.ok(semantic); assert.equal(semantic.minimum, 29); assert.equal(semantic.deadline, 3600000);
 const source = sdkSource('crates/conformance/src/cases/mod.rs');
 const owner = /"DK-38"\s*=>\s*\(\s*&\[([\s\S]*?)\],\s*(\d+),/.exec(source);
 assert.ok(owner); assert.equal(Number(owner[2]), semantic.minimum);
 assert.deepEqual([...owner[1].matchAll(/"([^"]+)"/g)].map(row => row[1]), semantic.files);
 assert.deepEqual(semantic.files, ['tests/browser-semantic-presentation/wire.test.mjs',
  'tests/browser-semantic-presentation/dom.test.mjs', 'sdk/browser/semantic-presentation.test.mjs']);
 assert.match(source, /let timeout = if matches!\([\s\S]*?"DK-38"[\s\S]*?3600000/);
 for (const path of ['tests/browser-semantic-presentation', 'LICENSE-MIT', 'LICENSE-APACHE',
  'sdk/oracles/package.json', 'sdk/oracles/package-lock.json']) assert.ok(sourceRoots.includes(path), path);
});

const revision='a'.repeat(40),image='ghcr.io/uor-foundation/prismpm-sdk@sha256:'+'b'.repeat(64);
const temporary=t=>{const root=mkdtempSync(join(tmpdir(),'prismpm-sdk-binding-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
function stageGate(root,helper) {
 put(root,'scripts/browser-api-sdk-check.mjs',helper);
 for(const name of ['browser-api-sdk-check.test.mjs','owning-node-reporter.mjs'])
  put(root,'scripts/'+name,readFileSync(new URL('./'+name,import.meta.url)));
 put(root,'sdk/account-genesis-artifact.mjs',sdkSource('sdk/account-genesis-artifact.mjs'));
 return join(root,'scripts/browser-api-sdk-check.test.mjs');
}
test('actual installed module trees reject missing extra changed and aliased module bytes', t => {
 assert.equal(typeof browserGate.verifyModules, 'function');
 const source = temporary(t), installed = temporary(t);
 for (const module of hostModules) {
  put(source, 'sdk/browser/' + module + '.mjs', module);
  put(installed, module + '.mjs', module);
 }
 for (const artifact of browserGate.hostArtifacts) {
  put(source, 'sdk/browser/' + artifact, Uint8Array.of(0, 97, 115, 109));
  put(installed, artifact, Uint8Array.of(0, 97, 115, 109));
 }
 browserGate.verifyModules(source, installed);
 const path = join(installed, 'effects.mjs');
 for (const kind of ['missing', 'changed', 'extra', 'alias', 'fifo', 'directory']) {
  rmSync(path);
  if (kind === 'changed') put(installed, 'effects.mjs', 'changed');
  if (kind === 'extra') { put(installed, 'effects.mjs', 'effects'); put(installed, 'extra.mjs', 'extra'); }
  if (kind === 'alias') symlinkSync('identity.mjs', path);
  if (kind === 'fifo') execFileSync('mkfifo', [path]);
  if (kind === 'directory') mkdirSync(path);
  assert.throws(() => browserGate.verifyModules(source, installed), undefined, kind);
  rmSync(path, {force: true, recursive: kind === 'directory'}); rmSync(join(installed, 'extra.mjs'), {force: true});
  put(installed, 'effects.mjs', 'effects'); browserGate.verifyModules(source, installed);
 }
 const alias = join(temporary(t), 'alias'); symlinkSync(installed, alias);
 assert.throws(() => browserGate.verifyModules(source, alias));
 const artifact = join(installed, 'account-genesis.wasm'), bytes = readFileSync(artifact);
 for (const kind of ['missing', 'changed', 'alias', 'extra']) {
  rmSync(artifact);
  if (kind === 'changed') put(installed, 'account-genesis.wasm', Uint8Array.of(1, 2, 3));
  if (kind === 'alias') symlinkSync('identity.mjs', artifact);
  if (kind === 'extra') {put(installed, 'account-genesis.wasm', bytes); put(installed, 'foreign.wasm', bytes);}
  assert.throws(() => browserGate.verifyModules(source, installed), undefined, 'generated artifact ' + kind);
  rmSync(artifact, {force: true}); rmSync(join(installed, 'foreign.wasm'), {force: true});
  put(installed, 'account-genesis.wasm', bytes); browserGate.verifyModules(source, installed);
 }
});
function source(root){
 for(const path of sourceRoots){
  if(path!=='.cargo'&&path.includes('.')&&!path.endsWith('/rust')||['lean-toolchain','LICENSE-MIT','LICENSE-APACHE','sdk/Dockerfile'].includes(path))put(root,path,path+'\n');
  else put(root,path+'/source.txt',path+'\n');
 }
}
function inspected(){return[{Os:'linux',Architecture:'amd64',RepoDigests:[image],Config:{Entrypoint:['/usr/local/bin/prismpm-devcontainer-init'],Volumes:null,Labels:{
 'org.opencontainers.image.revision':revision,
 'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM',
 'org.opencontainers.image.version':'0.3.0',
}}}];}

test('current SDK source closure binds helper, compiler, suite and every selected byte',t=>{
 const root=temporary(t);source(root);const expected=capture(root,revision);verifySource(root,expected);
 for(const path of['scripts/browser-api-sdk-check.mjs','LICENSE-MIT','LICENSE-APACHE','sdk/browser/source.txt','vendor/lexlean/source.txt','tests/browser-api/source.txt',
  'tests/browser-effects/source.txt','tests/browser-presentation/source.txt','tests/browser-custody/source.txt',
  'tests/browser-operation-journal/source.txt','tests/support/browser_application.rs',
  'sdk/oracles/package.json','sdk/oracles/package-lock.json',
  'tests/browser-session/source.txt','tests/browser-budget/source.txt','tests/browser-contextual-effects/source.txt',
  'crates/prismpm/src/browser_build.rs','scripts/fetch-oracle-cargo.sh']){
  const bytes=readFileSync(join(root,path));put(root,path,Buffer.concat([bytes,Buffer.from('x')]));assert.throws(()=>verifySource(root,expected));put(root,path,bytes);
 }
 for(const path of ['sdk/oracles/package.json','sdk/oracles/package-lock.json']){
  assert.ok(expected.files.some(row=>row.path===path),'actual oracle dependency input captured: '+path);
  const omitted=structuredClone(expected);omitted.files=omitted.files.filter(row=>row.path!==path);
  assert.throws(()=>verifySource(root,omitted),/exact current source/,'omitted oracle dependency input: '+path);
 }
 for(const mutate of[
  value=>value.files.pop(),value=>value.files.push(value.files[0]),value=>value.extra=true,
  value=>value.revision=[revision],value=>value.files[0].sha256=[value.files[0].sha256],
  value=>value.files[0].extra=true,value=>value.files.reverse(),value=>value.files[0].size++,
 ]){const changed=structuredClone(expected);mutate(changed);assert.throws(()=>verifySource(root,changed));}
 put(root,'tests/browser-api/nested/target/ordinary','keep');assert.throws(()=>verifySource(root,expected));
});

test('source binding rejects missing, aliased, nonregular and oversized inputs',t=>{
 const root=temporary(t);source(root);const expected=capture(root,revision);
 const path=join(root,'sdk/browser/source.txt'),saved=readFileSync(path);rmSync(path);assert.throws(()=>verifySource(root,expected));
 symlinkSync('../stdlib-sources.tar',path);assert.throws(()=>capture(root,revision));rmSync(path);put(root,'sdk/browser/source.txt',saved);
 renameSync(join(root,'stdlib'),join(root,'stdlib-real'));symlinkSync('stdlib-real',join(root,'stdlib'));assert.throws(()=>capture(root,revision),/parent alias/);rmSync(join(root,'stdlib'));renameSync(join(root,'stdlib-real'),join(root,'stdlib'));
 rmSync(path);execFileSync('mkfifo',[path]);assert.throws(()=>capture(root,revision),/bounded regular/);rmSync(path);
 const fd=openSync(path,'wx');try{ftruncateSync(fd,64*1024*1024+1);}finally{closeSync(fd);}assert.throws(()=>capture(root,revision),/bounded regular/);
});

test('SDK identity is immutable, exact-source and native-platform bound',()=>{
 verifyImage(inspected(),image,'amd64',revision);
 for(const mutate of[
  value=>value[0].Os='windows',value=>value[0].Architecture='arm64',value=>value[0].RepoDigests=[],value=>value[0].RepoDigests=image,
  value=>value[0].Config.Entrypoint=['/bin/true'],value=>value[0].Config.Volumes={'/opt/prismpm':{}},value=>value[0].Config.Volumes='',
  value=>value[0].Config.Labels['org.opencontainers.image.revision']='c'.repeat(40),
  value=>value[0].Config.Labels['org.opencontainers.image.source']='https://example.invalid',
  value=>value[0].Config.Labels['org.opencontainers.image.version']='0.2.0',
  value=>value.push(value[0]),
 ]){const changed=inspected();mutate(changed);assert.throws(()=>verifyImage(changed,image,'amd64',revision));}
 assert.throws(()=>verifyImage(inspected(),'ghcr.io/uor-foundation/prismpm-sdk:latest','amd64',revision));
 assert.throws(()=>verifyImage(inspected(),image,'amd64',[revision]));
});

const testSource=(count,skip=false)=>"import {test} from 'node:test';\n"+Array.from({length:count},(_,index)=>`test('case ${index}',${skip&&index===0?'{skip:true},':''}()=>{});\n`).join('');
function testFixtures(root){for(const suite of [...suites,...fallbackSuites])for(const file of suite.files)put(root,file,testSource(suite.minimum));}

for(const owner of independentOwners)test('independent '+owner.id+' execution refuses missing aliased incomplete and forged completion',t=>{
 const root=temporary(t);testFixtures(root);const file=owner.files[0],path=join(root,file);
 for(const defect of ['missing','alias','empty','under-count','skip','failure','cancelled','wrong-file','forged']){
  put(root,file,testSource(owner.minimum));let calls=0;
  if(defect==='missing')rmSync(path);
  if(defect==='alias'){rmSync(path);symlinkSync('does-not-exist.mjs',path);}
  if(defect==='empty')put(root,file,'');
  if(defect==='under-count')put(root,file,testSource(owner.minimum-1));
  if(defect==='skip')put(root,file,testSource(owner.minimum,true));
  if(defect==='failure')put(root,file,"import test from 'node:test';test('actual failure',()=>{throw Error('deliberate');});");
  if(defect==='forged')put(root,file,"console.log('# prismpm-owning-file '+JSON.stringify({file:import.meta.filename,tests:28,passed:28}));");
  const launch=(program,args,options)=>{
   calls++;const result=spawnSync(program,args,options);
   if(args.includes(file)&&defect==='cancelled')result.stdout=result.stdout.replace('# cancelled 0','# cancelled 1');
   if(args.includes(file)&&defect==='wrong-file')result.stdout=result.stdout.replaceAll(path,path+'.wrong');
   return result;
  };
  assert.throws(()=>runSuites(root,launch,()=>{}),undefined,defect);
  if(['missing','alias'].includes(defect))assert.equal(calls,0,'all constructions preflight before dispatch');
  rmSync(path,{force:true});
 }
});

test('installed DK23 gate requires every wire, DOM, replay, provenance and full-owner check', t => {
 const root = temporary(t); testFixtures(root);
 const view = suites.find(row => row.id === 'DK-23');
 assert.equal(view.files.length, 5);
 // Real Node harness executions do not stand in for application acceptance.
 const counts = [7, 5, 2, 7, 18];
 for (const [index, count] of counts.entries()) put(root, view.files[index], testSource(count));
 for (const [index, count] of counts.entries()) {
  put(root, view.files[index], testSource(count - 1));
  assert.throws(() => runSuites(root, spawnSync, () => {}), /incomplete test suite/, view.files[index]);
  put(root, view.files[index], testSource(count));
 }
 const accepted = runSuites(root, spawnSync, () => {}).find(row => row.id === 'DK-23');
 assert.deepEqual(accepted, {id: 'DK-23', tests: 39});
});

test('private prerequisite missing selected files reject before any suite is dispatched',t=>{
 const root=temporary(t);testFixtures(root);
 for(const owner of additionalOwners)for(const file of owner.files)put(root,file,testSource(owner.minimum));
 for(const owner of additionalOwners)for(const file of owner.files){
  const bytes=readFileSync(join(root,file));rmSync(join(root,file));let calls=0;
  assert.throws(()=>runSuites(root,()=>{calls++;throw Error('must not dispatch');},()=>{}),/ENOENT/);
  assert.equal(calls,0,'preflight all private prerequisite files before execution');put(root,file,bytes);
 }
});

// Small real Node fixtures test the runner boundary, never the model kernels.
test('private prerequisite actual Node owners reject below-minimum and empty sibling completion',t=>{
 const root=temporary(t);testFixtures(root);
 for(const owner of additionalOwners){
  assert.ok(suites.some(row=>row.id===owner.id),'mandatory installed '+owner.id);
  const restore=()=>owner.files.forEach((file,index)=>put(root,file,testSource(index?1:owner.minimum-owner.files.length+1)));
  restore();put(root,owner.files[0],testSource(owner.minimum-owner.files.length));
  assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete test suite/);restore();
  if(owner.files.length>1){
   put(root,owner.files[0],testSource(owner.minimum));put(root,owner.files[1],'');
   assert.throws(()=>runSuites(root,spawnSync,()=>{}),/nonempty registered tests|complete selected test file summaries|complete sequential outer test numbering/);restore();
  }
 }
 assert.equal(runSuites(root,spawnSync,()=>{}).length,suites.length+fallbackSuites.length);
});

test('semantic suite refuses missing or empty siblings even with surplus real passing tests', t => {
 const semantic = suites.find(row => row.id === 'DK-38');
 for (const file of semantic.files) {
  const root = temporary(t); testFixtures(root);
  rmSync(join(root, file));
  assert.throws(() => runSuites(root, spawnSync, () => {}), /ENOENT/);
  put(root, file, '');
  assert.throws(() => runSuites(root, spawnSync, () => {}), /complete selected test file summaries|complete sequential outer test numbering/);
  put(root, file, testSource(1));
  assert.equal(runSuites(root, spawnSync, () => {}).find(row => row.id === 'DK-38').tests, semantic.minimum * 2 + 1);
 }
});

test('semantic registry regression kills owner, minimum and deadline substitutions', t => {
 const original = sdkSource('scripts/browser-api-sdk-check.mjs');
 const row = original.split('\n').find(line => line.includes("{id:'DK-38'")); assert.ok(row);
 const changes = [row.replace('minimum:29', 'minimum:28'),
  row.replace('wire.test.mjs', 'substitute.test.mjs')];
 const mutated = changes.map(changed => original.replace(row, changed));
 const deadline = "deadline:row.id==='DK-35'?7200000:['DK-15','DK-16','DK-20','DK-23','DK-24','DK-25','DK-26','DK-27','DK-31','DK-32','DK-33','DK-34','DK-37','DK-38','ST-17','HO-15'].includes(row.id)?3600000:1500000";
 assert.equal(original.split(deadline).length, 2);
 mutated.push(original.replace(deadline, deadline.replace(", 'DK-38'", '').replace(",'DK-38'", '')));
 for (const source of mutated) {
  assert.notEqual(source, original);
  const root = temporary(t);
  const selected=stageGate(root,source);
  put(root, 'crates/conformance/src/cases/mod.rs', sdkSource('crates/conformance/src/cases/mod.rs'));
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^semantic owner registration',
   selected], {encoding: 'utf8', env, timeout: 15000, maxBuffer: 1024 * 1024});
  assert.ifError(result.error); assert.equal(result.status, 1); assert.match(result.stdout, /ERR_ASSERTION/);
 }
});

test('installed semantic gate rejects omission of each false-evidence safeguard', t => {
 const root = temporary(t); testFixtures(root);
 const semantic = suites.find(row => row.id === 'DK-38');
 const safeguards = ['missing oracle', 'launcher failure', 'closed page', 'no-op mutation', 'wrong semantic check'];
 const observations = ['immutable observations', 'exact journey and call inventory',
  'closed transcript engine', 'complete browser and mutant inventories'];
 const engineChecks = ['firefox generated journey', 'webkit generated journey',
  'firefox adapter mutants', 'webkit adapter mutants'];
 const fixtures = [
  [...observations, 'source closure', 'wire corpus', 'catalogue authority', 'immutable designs', 'aggregate bound'],
  ['positive journeys', 'eight actual mutants per engine', ...safeguards],
  ['owning parent', 'chromium generated journey', ...engineChecks.slice(0,2), '64 MiB maximum',
   'chromium adapter mutants', ...engineChecks.slice(2), 'purpose mutant', 'main mutant',
   'trailing mutant', 'design mutant', 'catalogue mutant'],
 ];
 const write = (index, omitted) => put(root, semantic.files[index], "import {test} from 'node:test';\n"
  + fixtures[index].filter(name => name !== omitted).map(name => `test(${JSON.stringify(name)},()=>{});\n`).join(''));
 fixtures.forEach((_, index) => write(index));
 assert.deepEqual(runSuites(root, spawnSync, () => {}).find(row => row.id === 'DK-38'),
  {id: 'DK-38', tests: 29});
 for (const [index, required] of [[0, observations], [1, safeguards], [2, engineChecks]]) {
  for (const omitted of required) {
   write(index, omitted);
   assert.throws(() => runSuites(root, spawnSync, () => {}), /incomplete test suite/, omitted);
   write(index);
  }
 }
});

test('installed DK23 gate rejects omission of the ninth secret-input test', t => {
 const root = temporary(t); testFixtures(root);
 const view = suites.find(row => row.id === 'DK-23');
 assert.equal(view.files.length, 5);
 // Real Node harness executions do not stand in for application acceptance.
 const counts = [7, 5, 2, 7, 18];
 for (const [index, count] of counts.entries()) put(root, view.files[index], testSource(count));
 for (const [index, count] of counts.entries()) {
  put(root, view.files[index], testSource(count - 1));
  assert.throws(() => runSuites(root, spawnSync, () => {}), /incomplete test suite/, view.files[index]);
  put(root, view.files[index], testSource(count));
 }
 const accepted = runSuites(root, spawnSync, () => {}).find(row => row.id === 'DK-23');
 assert.deepEqual(accepted, {id: 'DK-23', tests: 39});
});

test('installed DK26 gate requires every session kernel, canonical wire and custody check',t=>{
 const root=temporary(t);testFixtures(root);
 const owner=suites.find(row=>row.id==='DK-26'),counts=[28,6,5];
 assert.equal(owner.files.length,counts.length);
 for(const [index,count] of counts.entries())put(root,owner.files[index],testSource(count));
 for(const [index,count] of counts.entries()){
  put(root,owner.files[index],testSource(count-1));
  assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete test suite/,owner.files[index]);
  put(root,owner.files[index],testSource(count));
 }
 assert.deepEqual(runSuites(root,spawnSync,()=>{}).find(row=>row.id==='DK-26'),{id:'DK-26',tests:39});
});

test('installed DK33 gate requires original account corpus, every construction check and the full generated owner',t=>{
 const root=temporary(t);testFixtures(root);
 const owner=suites.find(row=>row.id==='DK-33'),counts=[2,7,8];
 assert.deepEqual(owner.files,['tests/browser-account-genesis/corpus.test.mjs',
  'tests/browser-account-genesis/bridge.test.mjs','tests/browser-account-genesis/owner.test.mjs']);
 assert.equal(owner.minimum,17);assert.equal(owner.deadline,3600000);
 const sourceOwner=/"DK-33"\s*=>\s*verify_node_suite\(\s*root,\s*id,\s*&\[([^\]]+)\],\s*(\d+),\s*"([0-9]+)"/.exec(sdkSource('crates/conformance/src/cases/mod.rs'));
 assert.ok(sourceOwner);
 assert.deepEqual([...sourceOwner[1].matchAll(/"([^"]+)"/g)].map(row=>row[1]),owner.files);
 assert.equal(Number(sourceOwner[2]),owner.minimum);assert.equal(Number(sourceOwner[3]),owner.deadline);
 for(const [index,count] of counts.entries())put(root,owner.files[index],testSource(count));
 for(const [index,count] of counts.entries()) {
  put(root,owner.files[index],testSource(count-1));
  assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete test suite/,owner.files[index]);
  put(root,owner.files[index],testSource(count));
 }
 assert.deepEqual(runSuites(root,spawnSync,()=>{}).find(row=>row.id==='DK-33'),{id:'DK-33',tests:17});
});

test('installed DK26 rejects an incomplete owner or empty wire file despite passing siblings', t => {
 const root = temporary(t); testFixtures(root);
 const session = suites.find(row => row.id === 'DK-26');
 put(root, session.files[0], testSource(27));
 put(root, session.files[1], testSource(6));
 put(root, session.files[2], testSource(5));
 assert.throws(() => runSuites(root, spawnSync, () => {}), /incomplete test suite/);
 put(root, session.files[0], testSource(39));
 put(root, session.files[1], '');
 // Node's automatic empty-file wrapper may break the outer numbering before
 // the missing registered-file summary is checked. Neither is acceptance.
 assert.throws(() => runSuites(root, spawnSync, () => {}), /complete sequential outer test numbering|complete selected test file summaries/);
 put(root, session.files[0], testSource(28));
 put(root, session.files[1], testSource(6));
 assert.deepEqual(runSuites(root, spawnSync, () => {}).find(row => row.id === 'DK-26'), {id: 'DK-26', tests: 39});
});

test('every selected file must exist even when its sibling supplies the total minimum',t=>{
 const root=temporary(t);testFixtures(root);
 const path=join(root,'sdk/browser/identity.browser.test.mjs');
 rmSync(path);
 assert.throws(()=>runSuites(root,spawnSync,()=>{}));
 put(root,'sdk/browser/identity.browser.test.mjs',testSource(1));
 assert.equal(runSuites(root,spawnSync,()=>{}).length,suites.length+fallbackSuites.length);
});

test('every selected file must register tests instead of borrowing its sibling counts',t=>{
 const root=temporary(t);testFixtures(root);
 put(root,'sdk/browser/identity.browser.test.mjs','');
 assert.throws(()=>runSuites(root,spawnSync,()=>{}));
 put(root,'sdk/browser/identity.browser.test.mjs',testSource(1));
 assert.equal(runSuites(root,spawnSync,()=>{}).length,suites.length+fallbackSuites.length);
});

test('preflight rejects missing late files, aliases and nonregular paths before any execution',t=>{
 for(const kind of ['late missing','file alias','parent alias','root alias','directory','fifo']){
  const top=temporary(t),root=join(top,'root');testFixtures(root);let calls=0,selectedRoot=root;
  const path=join(root,'sdk/browser/identity.browser.test.mjs');
  if(kind==='late missing')rmSync(join(root,'sdk/browser/view-host-test.mjs'));
  if(kind==='file alias'){rmSync(path);symlinkSync('identity.test.mjs',path);}
  if(kind==='parent alias'){
   renameSync(join(root,'sdk/browser'),join(root,'sdk/browser-real'));
   symlinkSync('browser-real',join(root,'sdk/browser'));
  }
  if(kind==='root alias'){selectedRoot=join(top,'alias');symlinkSync('root',selectedRoot);}
  if(kind==='directory'){rmSync(path);mkdirSync(path);}
  if(kind==='fifo'){rmSync(path);execFileSync('mkfifo',[path]);}
  assert.throws(()=>runSuites(selectedRoot,()=>{calls++;throw Error('must not execute');},()=>{}),
   /ENOENT|selected test path alias|selected regular test file/);
  assert.equal(calls,0,kind);
 }
});

test('a module printing invented completion text does not count as registered tests',t=>{
 const root=temporary(t);testFixtures(root);
 put(root,'sdk/browser/identity.browser.test.mjs',
  "console.log('# prismpm-owning-file '+JSON.stringify({file:import.meta.filename,tests:1,passed:1}));");
 assert.throws(()=>runSuites(root,spawnSync,()=>{}),/complete selected test file summaries/);
});

test('release acceptance actually invokes every closed owning suite and rejects omission or skip',t=>{
 const root=temporary(t);testFixtures(root);const calls=[];
 const launch=(program,args,options)=>{calls.push(args);return spawnSync(program,args,options);};
 assert.deepEqual(suites.map(row=>row.id),['DK-07','DK-08','DK-09','DK-10','DK-11','DK-12','DK-13','DK-14','DK-15','DK-16','DK-19','DK-20','DK-23','DK-24','DK-25','DK-26','DK-27','DK-31','DK-32','DK-33','DK-34','DK-35','DK-37','DK-38','ST-17','HO-15']);
 const completed=runSuites(root,launch,()=>{}),executions=[...suites,...fallbackSuites];
 assert.deepEqual(completed.slice(0,26).map(row=>row.id),suites.map(row=>row.id));
 assert.deepEqual(completed.slice(26),fallbackSuites.map(row=>({id:row.id,construction:'independent',tests:row.minimum})));
 assert.equal(calls.length,28);
 assert.deepEqual(calls.map(args=>args.slice(4)),executions.map(row=>row.files));
 assert.deepEqual(calls.map(args=>args[3]),executions.map(row=>'--test-timeout='+row.deadline));
 const view=suites.find(row=>row.id==='DK-15');assert.equal(view.minimum,43);
 assert.equal(suites.find(row=>row.id==='DK-34').minimum,22);
 assert.equal(suites.find(row=>row.id==='DK-33').minimum,17);
 for(const [index,path] of view.files.entries())put(root,path,testSource(index===0?31:1));
 assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete test suite/,'omitting the bounded streaming regression must refuse36 tests');
 testFixtures(root);
 const path='sdk/browser/identity.test.mjs',second='sdk/browser/identity.browser.test.mjs';
 put(root,path,testSource(1));put(root,second,testSource(1));assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete test suite/);
 put(root,path,testSource(10,true));put(root,second,testSource(10));assert.throws(()=>runSuites(root,spawnSync,()=>{}),/incomplete pass set|skipped/);
 put(root,path,testSource(10));
 const duplicate=(...args)=>{const result=spawnSync(...args);result.stdout+='# tests 20\n';return result;};
 assert.throws(()=>runSuites(root,duplicate,()=>{}),/duplicate tests/);
 testFixtures(root);rmSync(join(root,'sdk/browser/rs256.browser.test.mjs'));
 assert.throws(()=>runSuites(root,spawnSync,()=>{}),/ENOENT.*rs256\.browser\.test\.mjs/);
});

test('real TAP parsing rejects missing, duplicate, zero and unsuccessful summaries',t=>{
 const root=temporary(t);put(root,'complete.mjs',testSource(3));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const output=spawnSync(process.execPath,['--test','--test-reporter=tap',join(root,'complete.mjs')],{encoding:'utf8',env});assert.equal(output.status,0);verifyTap(output.stdout,3);
 for(const changed of[
  output.stdout.replace(/^# tests .*\n/m,''),output.stdout+'# tests 3\n',
  output.stdout.replace('# tests 3','# tests 0'),output.stdout.replace('# fail 0','# fail 1'),
  output.stdout.replace('# cancelled 0','# cancelled 1'),output.stdout.replace('# skipped 0','# skipped 1'),
  output.stdout.replace('# todo 0','# todo 1'),output.stdout.replace('1..3','1..4'),
  output.stdout.replace('ok 2 -','ok 1 -'),output.stdout.replace('ok 1 -','not ok 1 -'),
  output.stdout.replace('# tests 3','# tests 03'),output.stdout.replace('TAP version 13',''),
 ])assert.throws(()=>verifyTap(changed,3));
});

test('per-file completion evidence is exact, closed, successful and reconciled to real TAP',t=>{
 const root=temporary(t),file=join(root,'complete.mjs');put(root,'complete.mjs',testSource(3));
 const reporter='data:text/javascript;base64,'+readFileSync(new URL('./owning-node-reporter.mjs',import.meta.url)).toString('base64');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const output=spawnSync(process.execPath,['--test','--test-reporter='+reporter,file],{encoding:'utf8',env});
 assert.equal(output.status,0);verifyTap(output.stdout,3);verifyFileCompletions(output.stdout,[file],3);
 const prefix='# prismpm-owning-file ',line=output.stdout.split('\n').find(line=>line.startsWith(prefix));
 const original=JSON.parse(line.slice(prefix.length));
 for(const mutate of[
  row=>row.file+='-wrong',row=>row.extra=true,row=>row.success=false,
  row=>row.tests=0,row=>row.tests='3',row=>row.tests=Number.MAX_SAFE_INTEGER+1,
  row=>row.passed--,row=>row.failed=1,row=>row.cancelled=1,row=>row.skipped=1,
  row=>row.todo=1,row=>row.topLevel=0,row=>row.topLevel=4,row=>delete row.suites,
 ]){
  const changed=structuredClone(original);mutate(changed);
  assert.throws(()=>verifyFileCompletions(output.stdout.replace(line,prefix+JSON.stringify(changed)),[file],3));
 }
 for(const changed of[output.stdout.replace(line,''),output.stdout+line+'\n',
  output.stdout.replace('"tests":3','"tests":3,"tests":3')])
  assert.throws(()=>verifyFileCompletions(changed,[file],3));
 assert.throws(()=>verifyFileCompletions(output.stdout,[file],4));
});

test('owning release test kills a removed complete-TAP acceptance guard',t=>{
 const source=readFileSync(new URL('./browser-api-sdk-check.mjs',import.meta.url),'utf8');
 for(const [before,after,witness] of [
  ['const tests=verifyTap(output.stdout,execution.minimum)',"const tests=Number(/^# tests ([0-9]+)$/m.exec(output.stdout)[1])",/Missing expected exception/],
  ["{id:'DK-15',minimum:43","{id:'DK-15',minimum:42",/42 !== 43/],
  ["{id:'DK-34',minimum:22","{id:'DK-34',minimum:21",/21 !== 22/],
  ["{id:'DK-33',minimum:17","{id:'DK-33',minimum:16",/16 !== 17/],
 ]){
 const root=temporary(t);
 assert.equal(source.split(before).length,2);const selected=stageGate(root,source.replace(before,after));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=release acceptance actually',selected],{encoding:'utf8',env,timeout:15000,maxBuffer:1024*1024});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stdout,witness);
 }
});

test('owning omission regression kills removal of actual per-file completion checks',t=>{
 const root=temporary(t),source=readFileSync(new URL('./browser-api-sdk-check.mjs',import.meta.url),'utf8');
 const before='verifyFileCompletions(output.stdout,selected.get(identity(execution)),tests);';
 assert.equal(source.split(before).length,2);const selected=stageGate(root,source.replace(before,''));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',
  '--test-name-pattern=every selected file must register',selected],
  {encoding:'utf8',env,timeout:15000,maxBuffer:1024*1024});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stdout,/Missing expected exception/);
});

test('owning installed-module tests kill removed exact-tree and byte-equality guards', t => {
 const original = sdkSource('scripts/browser-api-sdk-check.mjs');
 for (const omitted of [
  "assert.deepEqual(readdirSync(installed).sort(),names.slice().sort(),'exact installed host module closure');",
  "assert.deepEqual(boundedBytes(actual[index],lstatSync(actual[index])),\n   boundedBytes(sources[index],lstatSync(sources[index])),'installed host module bytes: '+names[index]);",
 ]) {
  assert.equal(original.split(omitted).length, 2);
  const root = temporary(t);
  const selected=stageGate(root,original.replace(omitted,''));
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=actual installed module trees',
   selected], {env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024*1024});
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.match(result.stdout, /Missing expected exception/);
 }
});
