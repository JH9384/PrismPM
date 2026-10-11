import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const draft=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(draft,'../..');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export {createPrivateDriverTarget, ensureProdExport} from '../browser-view/compile.mjs';
import {createPrivateDriverTarget, ensureProdExport} from '../browser-view/compile.mjs';
function verifyPins(){
  const artifacts=readFileSync(join(repository,'model/dependencies.toml'),'utf8').split('[[dependency.artifact]]').slice(1).map(section=>{
    const text=section.split('[[dependency]]')[0];return {path:/^path = "([^"]+)"$/m.exec(text)?.[1],hash:/^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],tree:/^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
  });
  for(const name of ['vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust/MANIFEST.sha256','vendor/lexlean/MANIFEST.sha256']){
    const matches=artifacts.filter(row=>row.path===name);assert.equal(matches.length,1);const[{hash,tree}]=matches;
    const bytes=readFileSync(join(repository,name));assert.equal(sha(bytes),hash,name);if(!tree)continue;
    const seen=new Set();for(const line of bytes.toString('utf8').trimEnd().split('\n')){const row=/^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);assert.ok(row);const[,digest,path]=row;assert.ok(!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..'));assert.ok(!seen.has(path));seen.add(path);assert.equal(sha(readFileSync(join(repository,tree,path))),digest,path);}
  }
}
function toolchainPins() {
  const rustText = readFileSync(join(repository, 'rust-toolchain.toml'), 'utf8');
  const rust = /^channel = "([0-9]+\.[0-9]+\.[0-9]+)"$/m.exec(rustText)?.[1];
  const lean = readFileSync(join(repository, 'lean-toolchain'), 'utf8').trim();
  assert.ok(rust && /^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/.test(lean),
    'closed pinned compiler toolchains');
  const triple = {x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}[process.arch];
  assert.equal(process.platform, 'linux', 'compiler harness requires the pinned Linux SDK');
  assert.ok(triple, 'supported SDK compiler architecture');
  return {rust, lean, triple};
}
function compilerEnvironment(extra) {
  const {rust, lean, triple} = toolchainPins();
  const forbidden = new Set([
    'RUSTC_BOOTSTRAP',
    'RUSTC', 'RUSTDOC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
    'RUSTFLAGS', 'RUSTDOCFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_ENCODED_RUSTDOCFLAGS',
    'CARGO_BUILD_RUSTC', 'CARGO_BUILD_RUSTDOC', 'CARGO_BUILD_RUSTFLAGS',
    'CARGO_BUILD_RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER',
    'LEAN_PATH', 'LEAN_SRC_PATH', 'LEAN_SYSROOT', 'LEAN_CC', 'LEAN_AR', 'LEAN_CXX',
    'LEAN_OPTS', 'LEAN_FLAGS', 'LAKE_HOME', 'LAKE_CONFIG',
    'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'BASH_ENV', 'ENV',
  ]);
  for (const key of Object.keys(process.env)) {
    assert.ok(!forbidden.has(key) && !/^CARGO_PROFILE_/.test(key)
      && !/^CARGO_TARGET_.*_(?:RUSTFLAGS|LINKER|RUNNER)$/.test(key),
      'inherited compiler override refused: '+key);
  }
  if (process.env.RUSTUP_TOOLCHAIN !== undefined) assert.ok(
    [rust, rust+'-'+triple].includes(process.env.RUSTUP_TOOLCHAIN),
    'inherited compiler override refused: RUSTUP_TOOLCHAIN');
  if (process.env.ELAN_TOOLCHAIN !== undefined) assert.ok(process.env.ELAN_TOOLCHAIN === lean,
    'inherited compiler override refused: ELAN_TOOLCHAIN');
  for (const [key,value] of Object.entries(extra)) {
    assert.ok(['CARGO_TARGET_DIR','LEAN_PATH'].includes(key), 'unowned compiler override refused: '+key);
    assert.ok(typeof value === 'string' && value.startsWith('/') && resolve(value) === value
      && !/[:\r\n\0]/.test(value), 'confined compiler path required: '+key);
  }
  return {...process.env, PATH:'/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    CARGO_NET_OFFLINE:'true', RUSTUP_TOOLCHAIN:rust+'-'+triple, ELAN_TOOLCHAIN:lean, ...extra};
}
function terminateOwnedGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  const signal = name => {
    try { process.kill(-pid, name); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  if (!signal('SIGTERM')) return;
  // A successful/failed parent can leave grandchildren behind after timeout
  // itself exits. Escalate only this invocation's detached process group.
  const deadline = performance.now()+250;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (performance.now() < deadline) {
    if (!signal(0)) return;
    Atomics.wait(pause, 0, 0, 10);
  }
  signal('SIGKILL');
}
function execute(program,args,cwd,env={}) {
  const childEnvironment = compilerEnvironment(env);
  const tools = {cargo:'/usr/local/cargo/bin/cargo',rustc:'/usr/local/cargo/bin/rustc',
    lean:'/usr/local/elan/bin/lean',lake:'/usr/local/elan/bin/lake',node:process.execPath,tar:'/usr/bin/tar'};
  const executable = tools[program] ?? program;
  assert.ok(typeof executable === 'string' && executable.startsWith('/'),
    'compiler command must be SDK-owned or an exact generated executable');
  if (Object.hasOwn(env,'LEAN_PATH')) assert.ok(executable.endsWith('/prod-export'),
    'LEAN_PATH belongs only to the exact generated exporter');
  const result = spawnSync('/usr/bin/timeout',
    ['--signal=TERM','--kill-after=5s','360s',executable,...args],
    {cwd,detached:true,encoding:'utf8',timeout:370000,killSignal:'SIGKILL',
      maxBuffer:32*1024*1024,env:childEnvironment});
  terminateOwnedGroup(result.pid);
  assert.ifError(result.error);
  assert.equal(result.status,0,program+' '+args.join(' ')+'\n'+result.stdout+'\n'+result.stderr);
  return result.stdout;
}
export function verifyCompilerTools() {
  const {rust, lean, triple} = toolchainPins();
  const verbose = command => execute(command,['--version','--verbose'],repository);
  for (const command of ['rustc','cargo']) {
    const version = verbose(command);
    assert.equal(/^release: (.+)$/m.exec(version)?.[1],rust, 'actual '+command+' release');
    assert.equal(/^host: (.+)$/m.exec(version)?.[1],triple, 'actual '+command+' architecture');
  }
  const version = lean.slice('leanprover/lean4:v'.length);
  const authorities = readFileSync(join(repository,'model/authorities.toml'),'utf8')
    .split('[[authority]]').slice(1).filter(section =>
      /^canonical_identifier = "leanprover\/lean4"$/m.test(section)
      && new RegExp('^edition = "'+version.replaceAll('.','\\.')+'"$', 'm').test(section));
  assert.equal(authorities.length,1,'one exact authoritative Lean release');
  const revision = /^revision = "([0-9a-f]{40})"$/m.exec(authorities[0])?.[1];
  assert.ok(revision,'immutable Lean source revision');
  assert.equal(execute('lean',['--version'],repository).trim(),
    'Lean (version '+version+', '+triple+', commit '+revision+', Release)');
  assert.match(execute('lake',['--version'],repository).trim(),
    new RegExp('^Lake version [0-9]+\\.[0-9]+\\.[0-9]+-src\\+'+revision.slice(0,7)
      +' \\(Lean version '+version.replaceAll('.','\\.')+'\\)$'));
}

let compilerToolsVerified = false;
export function run(program,args,cwd,env={}) {
  // Refuse overrides before even the tool-version subprocesses are executed.
  compilerEnvironment(env);
  if (!compilerToolsVerified) { verifyCompilerTools(); compilerToolsVerified = true; }
  return execute(program,args,cwd,env);
}
export function prepare(){
  verifyPins();
  const work=mkdtempSync(join(tmpdir(),'prismpm-journal-'));
  let completed=false;
  try {
  const files=['Workspace','WorkspaceEnvelope','WorkspaceJournal','WorkspaceJournalCorpus'];
  const sources=new Map(files.map(name=>[name,readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1',name+'.lex.tex'))]));
  assert.equal(sha(sources.get('Workspace')),'32e718bc606af3cd00703558ec4c1ecdcf1e69239e88adb6ad3a364e69aacc4e');
  assert.equal(sha(sources.get('WorkspaceEnvelope')),'ab5ca1097924ab1286c66cb7e8163ba9429153175c386b674af5e75f86f8855c');
  const project=join(work,'project'),sourceRoot=join(project,'src/Foundation/Browser/V1');mkdirSync(sourceRoot,{recursive:true});
  for(const [name,bytes]of sources)writeFileSync(join(sourceRoot,name+'.lex.tex'),bytes,{flag:'wx'});
  for(const file of ['lexlean.toml','lakefile.toml','lean-toolchain'])copyFileSync(join(draft,file),join(project,file));
  copyFileSync(join(repository,'rust-toolchain.toml'),join(work,'rust-toolchain.toml'));
  const driverTarget=createPrivateDriverTarget(work);
  run('cargo',['build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0','--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3','--manifest-path',join(draft,'driver/Cargo.toml')],repository,{CARGO_TARGET_DIR:driverTarget});
  const driver=join(driverTarget,'debug/browser-workspace-journal-driver');
  run('lake',['update'],project);
  const verified=JSON.parse(run(driver,['verify',join(project,'lexlean.toml')],repository));
  assert.deepEqual(verified.modules,files.map(n=>'Foundation.Browser.V1.'+n));
  const lean=join(work,'lean'),leanSource=join(lean,'PrismPM/Foundation/Browser/V1');mkdirSync(leanSource,{recursive:true});
  for(const name of files)copyFileSync(join(verified.root,'modules/PrismPM/Foundation/Browser/V1',name+'.lean'),join(leanSource,name+'.lean'));
  copyFileSync(join(repository,'lean-toolchain'),join(lean,'lean-toolchain'));
  writeFileSync(join(lean,'lakefile.toml'),'name = "workspace_journal_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['+files.map(n=>'"PrismPM.Foundation.Browser.V1.'+n+'"').join(',')+']\n',{flag:'wx'});
  run('lake',['build','PrismGenerated'],lean);
  const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
  const exported=join(work,'export');run(prodExport,['--module','PrismPM.Foundation.Browser.V1.WorkspaceJournal','--root','PrismPM.Foundation.Browser.V1.WorkspaceJournal.workspaceJournalBytes','--ir-module','BrowserWorkspaceJournal','--out',exported],exporter,{LEAN_PATH:join(lean,'.lake/build/lib/lean')});
  const generated=join(work,'generated');const generation=JSON.parse(run(driver,['generate',join(exported,'kernel.ir'),generated,repository],repository));
  const runner=join(work,'runner');mkdirSync(join(runner,'src'),{recursive:true});copyFileSync(join(draft,'runner.rs'),join(runner,'src/main.rs'));
  writeFileSync(join(runner,'Cargo.lock'),'version = 4\n[[package]]\nname = "browser-workspace-journal-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-workspace-journal-runner"\nversion = "0.1.0"\ndependencies = ["browser-workspace-journal-core-probe"]\n',{flag:'wx'});
  const nativeTarget=join(work,'native-target');
  function compileNative(standard){writeFileSync(join(runner,'Cargo.toml'),'[package]\nname = "browser-workspace-journal-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-workspace-journal-core-probe = {path = "../generated", default-features = '+standard+'}\n');run('cargo',['build','--locked','--offline','--release','--manifest-path',join(runner,'Cargo.toml')],runner,{CARGO_TARGET_DIR:nativeTarget});return join(nativeTarget,'release/browser-workspace-journal-runner');}
  const guest=join(work,'guest');assert.deepEqual(JSON.parse(run(driver,['generate-wasm',join(exported,'kernel.ir'),guest,repository],repository)),generation);run('cargo',['build','--locked','--offline','--release'],guest,{CARGO_TARGET_DIR:join(guest,'target')});
  const wasmBytes=readFileSync(join(guest,'target/wasm32-unknown-unknown/release/browser_workspace_journal_wasm_probe.wasm'));
  verifyPins();assert.equal(generation.ir_sha256,sha(readFileSync(join(exported,'kernel.ir'))));
  completed=true;
  return {work,sources,verified,generation,compileNative,runner,wasmBytes};
  } finally { if(!completed)rmSync(work,{recursive:true,force:true}); }
}
