import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtempSync} from 'node:fs';
import {verifyJournalFaults} from '../../tests/browser-journal/adapter-faults.mjs';
import {verifyJournalConcurrency} from '../../tests/browser-journal/adapter-concurrency.mjs';
import {verifyDiagnostics} from '../../tests/browser-journal/diagnostics.mjs';
import {test} from 'node:test';
import {prepare,run,draft,repository,sha} from '../../tests/browser-journal/compile.mjs';
import {browserJournalFixture} from '../../tests/browser-journal/browser-fixture.mjs';

export function corpus(source=readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1/WorkspaceJournalCorpus.lex.tex'),'utf8')){const data=JSON.parse(source.split('\n').find(l=>l.startsWith('\\semanticdata{')).slice(14,-1));assert.equal(data.spec,'lexlean/semantic-module/1');const defs=new Map(data.declarations.map(d=>[d.name,d]));assert.equal(defs.size,data.declarations.length);const cache=new Map(),used=new Set();function expand(name,active=new Set()){assert.ok(!active.has(name)&&active.size<40);used.add(name);if(cache.has(name))return cache.get(name);const d=defs.get(name);assert.equal(d.kind,'definition');assert.deepEqual(d.parameters,[]);assert.deepEqual(d.result,{kind:'bytes'});const next=new Set([...active,name]);function bytes(x){if(x.kind==='bytes'){assert.ok(x.hex.length<=512);return Buffer.from(x.hex,'hex');}if(x.kind==='call'){assert.deepEqual(x.arguments,[]);assert.match(x.function.name,/^fixtureData[0-9]+$/);return expand(x.function.name,next);}assert.equal(x.kind,'primitive');assert.equal(x.operation,'append');assert.deepEqual(x.result,{kind:'bytes'});assert.equal(x.arguments.length,2);const result=Buffer.concat(x.arguments.map(bytes));assert.ok(result.length<=1235981);return result;}const result=bytes(d.body);cache.set(name,result);return result;}const ids=[...defs.keys()].filter(n=>n.startsWith('request')).map(n=>n.slice(7));assert.equal(ids.length,61);const vectors=ids.map(id=>{const probe=defs.get('probe'+id);assert.deepEqual(probe.body,{arguments:[{arguments:[{arguments:[],function:{name:'request'+id},kind:'call'}],function:{module:'Foundation.Browser.V1.WorkspaceJournal',name:'workspaceJournalBytes'},kind:'call'},{arguments:[],function:{name:'response'+id},kind:'call'}],kind:'primitive',operation:'equal',result:{kind:'bool'}});used.add(probe.name);return {id,request:expand('request'+id),response:expand('response'+id)};});assert.deepEqual([...used].sort(),[...defs.keys()].sort());return vectors;}

test('journal fixture authoring preserves every vector and both complete histories',()=>{
  const vectors=corpus();
  const tsv=run('node',[join(draft,'corpus.mjs'),'--tsv'],repository);
  assert.equal(sha(tsv),'1b102da09c797ae86fab96ad72cf24994b2892e5a77fd7ba605e7587eca7a25d');
  const generated=run('node',[join(draft,'corpus.mjs')],repository);
  assert.equal(sha(generated),sha(readFileSync(join(repository,
    'stdlib/src/Foundation/Browser/V1/WorkspaceJournalCorpus.lex.tex'))),'byte-exact corpus authoring');
  const authored=corpus(generated);
  assert.deepEqual(authored.map(row=>row.id),vectors.map(row=>row.id));
  for(let index=0;index<vectors.length;index++)for(const prefix of ['request','response'])
    assert.ok(authored[index][prefix].equals(vectors[index][prefix]),prefix+vectors[index].id+' bytes');
  for(const mode of ['--history','--history-post']){
    const rows=run('node',[join(draft,'corpus.mjs'),mode],repository).trimEnd().split('\n');
    assert.equal(rows.length,1025);assert.equal(rows[0].split('\t')[0],'Target');
    const head=Buffer.from(rows[0].split('\t')[1],'hex');assert.equal(head.readUInt16BE(36),1024);
    for(let index=0;index<1024;index++){
      const [name,id,hex]=rows[index+1].split('\t'),bytes=Buffer.from(hex,'hex');
      assert.equal(name,'Event'+index);assert.equal(sha(bytes),id);
      assert.ok(head.subarray(38+index*64,70+index*64).equals(bytes.subarray(167,199)));
      assert.equal(head.subarray(70+index*64,102+index*64).toString('hex'),id);
    }
  }
});

test('modeled journal corpus names the complete owning entrypoint and literal closure',()=>{
  const vectors=corpus();assert.equal(vectors.length,61);
  const digest=rows=>sha(rows.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''));
  assert.equal(digest(vectors.slice(0,58)),'34f4caa2a69451e120d9609ce860cad67ceed9799d5cfd69483f65c9c27e38cc','all original58 vectors remain byte-exact');
  assert.equal(digest(vectors.slice(0,60)),'b80189daf64105da70bd6b96de561613ae6b35b4ec02361d414d5c215c8f6de4');
  assert.equal(digest(vectors),'1b102da09c797ae86fab96ad72cf24994b2892e5a77fd7ba605e7587eca7a25d');
});
function state(pid) {
  try {
    const row=readFileSync('/proc/'+pid+'/stat','utf8');
    const fields=row.slice(row.lastIndexOf(') ')+2).trim().split(' ');
    return {state:fields[0],started:fields[19]};
  } catch(error) {if(error.code==='ENOENT')return null;throw error;}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verifyProcessCleanup(run) {
  // Signal readiness only after the handler is installed. Parent failure must
  // not race registration of the stubborn grandchild's SIGTERM handler.
  const parent=String.raw`
    const {spawn}=require('node:child_process'),fs=require('node:fs');
    const child=spawn(process.execPath,['-e',
      "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],
      {stdio:['ignore','ignore','ignore','ipc']});
    const timer=setTimeout(()=>{child.kill('SIGKILL');process.exit(9);},5000);
    child.once('message',message=>{
      if(message!=='ready')process.exit(10);
      clearTimeout(timer);
      const fields=fs.readFileSync('/proc/'+child.pid+'/stat','utf8').split(') ')[1].trim().split(' ');
      console.log('OWNED_CHILD='+child.pid+':'+fields[19]);
      child.unref();child.disconnect();process.exit(7);
    });
  `;
  let pid,started,caught;
  try {
    try{run('node',['-e',parent],tmpdir());}catch(error){caught=error;}
    assert.ok(caught,'failed compiler command was accepted');
    const match=/OWNED_CHILD=([0-9]+):([0-9]+)/.exec(caught.message);
    assert.ok(match,'stubborn child confirms installed handler and exact identity');
    pid=Number(match[1]);started=match[2];
    for(let attempt=0;attempt<100;attempt++){
      const current=state(pid);
      if(current===null||current.started!==started||current.state==='Z')return;
      await delay(10);
    }
    assert.fail('owned stubborn compiler descendant survived group cleanup');
  } finally {
    // Even a true RED must not leave its deliberately stubborn process alive.
    // Do not signal any reused PID or any other invocation's process group.
    if(pid){const current=state(pid);if(current?.started===started&&current.state!=='Z'){
      try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    }}
  }
}
function verifyCompilerEnvironment(run,repository) {
  const work=mkdtempSync(join(tmpdir(),'prismpm-compiler-environment-'));
  const forbidden = [
    'RUSTC_BOOTSTRAP','CARGO_PROFILE_RELEASE_OPT_LEVEL','CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS',
    'CARGO_PROFILE_RELEASE_PANIC',
    'RUSTC','RUSTDOC','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTFLAGS','RUSTDOCFLAGS',
    'CARGO_ENCODED_RUSTFLAGS','CARGO_ENCODED_RUSTDOCFLAGS','CARGO_BUILD_RUSTC','CARGO_BUILD_RUSTDOC',
    'CARGO_BUILD_RUSTFLAGS','CARGO_BUILD_RUSTC_WRAPPER','CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER',
    'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS','CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER',
    'CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUNNER','LEAN_PATH','LEAN_SRC_PATH','LEAN_SYSROOT',
    'LEAN_CC','LEAN_AR','LEAN_CXX','LEAN_OPTS','LEAN_FLAGS','LAKE_HOME','LAKE_CONFIG',
    'NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','BASH_ENV','ENV',
  ];
  try {
    for (const key of [...forbidden,'RUSTUP_TOOLCHAIN','ELAN_TOOLCHAIN']) {
      const prior=process.env[key],marker=join(work,key);
      try {
        const planted = {RUSTC_BOOTSTRAP:'1',CARGO_PROFILE_RELEASE_OPT_LEVEL:'0',
          CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS:'false',CARGO_PROFILE_RELEASE_PANIC:'abort',
          NODE_OPTIONS:'--no-warnings',LD_PRELOAD:''};
        process.env[key]=Object.hasOwn(planted,key)?planted[key]:'/untrusted/compiler';
        assert.throws(()=>run('node',['-e',"require('node:fs').writeFileSync(process.argv[1],'executed')",marker],repository),
          error=>error.message.includes('inherited compiler override refused: '+key),key+' must fail before execution');
        assert.equal(existsSync(marker),false,key+' executed a child');
      } finally {if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
    }
    assert.throws(()=>run('node',['-e',''],repository,{RUSTC:'/untrusted/compiler'}),
      /unowned compiler override refused: RUSTC/);
    assert.throws(()=>run('node',['-e',''],repository,{LEAN_PATH:work}),
      /LEAN_PATH belongs only to the exact generated exporter/);
    const priorRust=process.env.RUSTUP_TOOLCHAIN,priorLean=process.env.ELAN_TOOLCHAIN,priorThreads=process.env.LEAN_NUM_THREADS;
    const rust=/^channel = "(.+)"$/m.exec(readFileSync(join(repository,'rust-toolchain.toml'),'utf8'))[1];
    const lean=readFileSync(join(repository,'lean-toolchain'),'utf8').trim();
    const triple={x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}[process.arch];
    try {
      process.env.ELAN_TOOLCHAIN=lean;
      for(const value of [rust,rust+'-'+triple])for(const threads of [undefined,'9999']){
        process.env.RUSTUP_TOOLCHAIN=value;
        if(threads===undefined)delete process.env.LEAN_NUM_THREADS;else process.env.LEAN_NUM_THREADS=threads;
        const actual=JSON.parse(run('node',['-e',
          'console.log(JSON.stringify([process.env.RUSTUP_TOOLCHAIN,process.env.ELAN_TOOLCHAIN,process.env.CARGO_NET_OFFLINE,process.env.LEAN_NUM_THREADS]))'],repository));
        assert.deepEqual(actual,[rust+'-'+triple,lean,'true','2']);
      }
    } finally {
      if(priorRust===undefined)delete process.env.RUSTUP_TOOLCHAIN;else process.env.RUSTUP_TOOLCHAIN=priorRust;
      if(priorLean===undefined)delete process.env.ELAN_TOOLCHAIN;else process.env.ELAN_TOOLCHAIN=priorLean;
      if(priorThreads===undefined)delete process.env.LEAN_NUM_THREADS;else process.env.LEAN_NUM_THREADS=priorThreads;
    }
  } finally {rmSync(work,{recursive:true,force:true});}
}

test('failed compiler command terminates only its isolated stubborn descendant process group',()=>verifyProcessCleanup(run));
test('compiler environment rejects unowned overrides before executing children',async()=>{
  verifyCompilerEnvironment(run,repository);
  const view=await import('../../tests/browser-view/compile.mjs');
  verifyCompilerEnvironment(view.run,view.repository);
});
test('fresh LexLean, normal Lean C, native/no_std and CoreWasm journal execution',{timeout:1200000},async t=>{
  const vectors=corpus();const build=prepare();t.after(()=>{rmSync(build.work,{recursive:true,force:true});});
  t.diagnostic('work '+build.work+'; source '+build.verified.source_id+'; attestation '+build.verified.attestation_id+'; LCNF '+build.generation.ir_sha256);
  const path=join(build.work,'vectors.tsv');writeFileSync(path,vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''),{flag:'wx'});
  for(const standard of [true,false]){const binary=build.compileNative(standard);const output=run(binary,[path],build.runner);assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(m=>m[1]),vectors.map(v=>v.id));assert.match(output,/PASS 61 complete generated journal vectors twice/);await t.test(standard?'generated native':'generated no_std',()=>{});t.diagnostic(output.trim());}
  const ledgerNative=build.compileNative(true);
  for(const mode of ['--history','--history-post']){
    const history=join(build.work,mode.slice(2)+'.tsv');writeFileSync(history,run('node',[join(draft,'corpus.mjs'),mode],repository),{flag:'wx'});
    const ledger=run(ledgerNative,['--replay',history],build.runner);assert.match(ledger,/PASS full1024 append exact state\/head/);assert.match(ledger,/PASS full1024 replay exact state\/head/);t.diagnostic(mode+' '+ledger.trim());
  }
  await t.test('generated native both full1024 histories append and replay exact maximum Grant and Post states',()=>{});
  const module=new WebAssembly.Module(build.wasmBytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);let maximum=0;
  function invoke(input){const instance=new WebAssembly.Instance(module,{});const pointer=instance.exports.holo_alloc(input.length);new Uint8Array(instance.exports.memory.buffer,pointer,input.length).set(input);const packed=BigInt.asUintN(64,instance.exports.holo_run(pointer,input.length));const offset=Number(packed>>32n),length=Number(packed&0xffffffffn);assert.ok(length<=1166008&&offset+length<=instance.exports.memory.buffer.byteLength);maximum=Math.max(maximum,instance.exports.memory.buffer.byteLength);assert.ok(maximum<=640*65536);return Buffer.from(new Uint8Array(instance.exports.memory.buffer,offset,length));}
  for(const vector of vectors)for(let repeat=0;repeat<2;repeat++){if(vector.request.length>1235980){assert.equal(vector.id,'RequestOverAllocationCap');assert.throws(()=>invoke(vector.request),WebAssembly.RuntimeError);}else {const actual=invoke(vector.request);assert.deepEqual(actual,vector.response,vector.id);if(actual[0]===0&&[1,3].includes(vector.request[0])){const head=actual.subarray(7,7+actual.readUIntBE(1,3)),check=Buffer.concat([Buffer.from([0]),head]);assert.deepEqual(invoke(check),check,vector.id+' generated candidate-head closure');}}}
  await t.test('generated CoreWasm all journal vectors twice, actual full1024 head and maximum state',()=>{});t.diagnostic('maximum guest memory '+maximum);
  const {withBrowser}=await import(new URL('./browser-test-server.mjs',import.meta.url));
  const browserResult=await withBrowser(async({browser,baseURL})=>{const page=await browser.newPage();await page.goto(baseURL);return page.evaluate(browserJournalFixture,{wasmBytes:Array.from(build.wasmBytes),genesisTemplate:vectors.find(v=>v.id==='AppendGenesis').request.subarray(39).toString('hex')});});
  assert.equal(browserResult.count,6);
  assert.deepEqual(browserResult.cases,['zero workspace rejected before candidate or commit','unowned completion token','caller supplied success receipt','replayed completion token',
    'real P-256 genesis and atomic object/head commit','distinct signed object cannot replay the same event ID',
    'reader cannot post','revoked contributor cannot post',
    'reopened IndexedDB authenticated replay and identity','concurrent plans preserve committed state on real CAS conflict',
    'tampered replay envelope','missing replay envelope','authenticated events in wrong replay order',
    'valid signed stale branch cannot prepare again','wrong signing context','valid signature with forged event ID',
    'valid signature cannot claim another principal','real storage failure never promotes state',
    'real object limit aborts the whole transaction']);
  const browserVectors=join(build.work,'browser-vectors.tsv');
  writeFileSync(browserVectors,browserResult.calls.map(([input,output],index)=>'Browser'+index+'\t'+input+'\t'+output+'\n').join(''),{flag:'wx'});
  const browserNative=run(build.compileNative(true),[browserVectors],build.runner);
  assert.match(browserNative,new RegExp('PASS '+browserResult.calls.length+' complete generated journal vectors twice'));
  for(const [input,output]of browserResult.calls)assert.equal(invoke(Buffer.from(input,'hex')).toString('hex'),output);
  await t.test('actual Chromium WebCrypto and IndexedDB: authenticated append/replay, roles, stale CAS and private completion',()=>{});
  t.diagnostic('browser boundary cases '+browserResult.cases.length+'; native/Wasm cross-checked calls '+browserResult.calls.length);
  const native = build.compileNative(true);
  const host = (name, options = {}) => ({wasmBytes:build.wasmBytes,native,
    work:mkdtempSync(join(build.work,name+'-')),...options});
  const faultEvidence = await verifyJournalFaults(host('faults'));
  assert.equal(faultEvidence.cases.length,34);
  const concurrencyEvidence = await verifyJournalConcurrency(host('concurrency'));
  assert.equal(concurrencyEvidence.cases.length,8);
  const diagnostics = await verifyDiagnostics(host('diagnostics'));
  await t.test('private SDK adapter actual storage faults, concurrency and exact diagnostic boundaries',()=>{});
  t.diagnostic('adapter faults '+faultEvidence.cases.length+'; concurrency '+concurrencyEvidence.cases.length+
    '; genuine native transcripts '+(faultEvidence.calls+concurrencyEvidence.calls)+'; diagnostic cases '+diagnostics.cases.length+
    '; exact adapter '+diagnostics.sourceSha256);
  await assert.rejects(verifyJournalFaults(host('signature-mutant',{mutant:'signature'})),/signature mutation cannot append: expected signature-invalid/);
  await assert.rejects(verifyJournalConcurrency(host('capture-mutant',{mutant:'capture'})),/detached caller buffer was not synchronously captured/);
  await assert.rejects(verifyJournalConcurrency(host('cas-mutant',{mutant:'cas'})),/competing CAS admitted both histories/);
  await assert.rejects(verifyJournalConcurrency(host('admission-mutant',{mutant:'admission'})),/saturated append must reject journal-busy before capture/);
  await t.test('actual signature, input-capture, admission and atomic-CAS mutants are rejected by their owning assertions',()=>{});
  await assert.rejects(verifyJournalFaults(host('transcript-mutant',{transcriptMutant:'response'})),/failed: browser0 bytes/);
  await t.test('mutated genuine browser response transcript fails independent generated native replay',()=>{});
  for(const[name,bytes]of build.sources)assert.deepEqual(readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1',name+'.lex.tex')),bytes);
});
