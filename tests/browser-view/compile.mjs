import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireCompilerOwner} from './compiler-owner.mjs';
import {isCapturedCompilerDriver} from './compiler-artifact.mjs';
export const draft=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(draft,'../..');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function sourceFile(repo, name) {
  const path = resolve(repo, name);
  assert.equal(realpathSync(path), path, 'aliased compiler source refused: '+name);
  const metadata = lstatSync(path);
  assert.ok(metadata.isFile() && metadata.nlink === 1, 'singly owned regular compiler source required: '+name);
  return readFileSync(path);
}
function verifyPins(repo = repository){
  const captured = new Map();
  const read = name => { const bytes=sourceFile(repo,name); captured.set(name,bytes); return bytes; };
  const dependencies = read('model/dependencies.toml');
  assert.deepEqual(dependencies, sourceFile(repository, 'model/dependencies.toml'), 'compiler dependency authority differs');
  const artifacts=dependencies.toString('utf8').split('[[dependency.artifact]]').slice(1).map(section=>{
    const text=section.split('[[dependency]]')[0];return {path:/^path = "([^"]+)"$/m.exec(text)?.[1],hash:/^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],tree:/^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
  });
  for(const name of ['vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust/MANIFEST.sha256','vendor/lexlean/MANIFEST.sha256']){
    const matches=artifacts.filter(row=>row.path===name);assert.equal(matches.length,1);const[{hash,tree}]=matches;
    const bytes=read(name);assert.equal(sha(bytes),hash,name);if(!tree)continue;
    const seen=new Set();for(const line of bytes.toString('utf8').trimEnd().split('\n')){const row=/^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);assert.ok(row);const[,digest,path]=row;assert.ok(!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..'));assert.ok(!seen.has(path));seen.add(path);assert.equal(sha(read(join(tree,path))),digest,path);}
  }
  return captured;
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
    CARGO_NET_OFFLINE:'true', RUSTUP_TOOLCHAIN:rust+'-'+triple, ELAN_TOOLCHAIN:lean, ...extra, LEAN_NUM_THREADS:'2'};
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
// Diagnostics only: no command, argument, path, payload or environment is logged.
const compilerDriverNames = new Set([
  'browser-budget-driver', 'browser-custody-driver', 'browser-effects-driver',
  'browser-operation-journal-driver', 'browser-presentation-driver',
  'browser-workspace-command-driver', 'browser-workspace-envelope-driver',
  'browser-workspace-journal-driver', 'browser-workspace-model-driver',
  'browser-workspace-query-driver', 'browser-workspace-view-driver',
  'publication-admission-driver',
]);
export function compilerPhase(program,args,artifact) {
  if (['cargo','rustc','lean','lake'].includes(program) && args[0]?.startsWith('--version')) return 'toolchain-check';
  if (program === 'tar') return 'archive-extraction';
  if (['cargo','lake'].includes(program) && args[0] === 'clean') return 'artifact-cleanup';
  if (program === 'cargo') return args[0] === 'build' ? 'rust-compilation' : 'unclassified-execution';
  if (program === 'lake') {
    if (args[0] === 'update') return 'lake-update';
    if (args[0] === 'build') return args[1] === 'prod-export' ? 'exporter-construction' : 'generated-module-build';
    return 'unclassified-execution';
  }
  if (program.endsWith('/prod-export')) return 'kernel-export';
  // Raw registered compiler paths and actual privately captured driver owners
  // are diagnostic sources. A generic basename alone is not an owner receipt.
  const raw = /\/driver-target\/debug\/([^/]+)$/.exec(program);
  if ((raw && compilerDriverNames.has(raw[1])) || isCapturedCompilerDriver(artifact,program)) {
    if (['verify','check'].includes(args[0])) return 'lexlean-verification';
    if (['native','generate'].includes(args[0])) return 'native-code-generation';
    if (['wasm','generate-wasm','fixture','size','p256','point','pkce','labels','intent','secret','route','sink',
      'maxroute','maxsink','maxfield','maxsecret','progress','maxprogress','guest','journal','partition',
      'generate-journal-wasm','generate-probe-wasm','predecessor','session','observation','descriptor',
      'reservation','retention','layout','tail','parity','context','recovery','metadata','signed-context',
      'account-genesis','context-fields-wasm','admission-wasm','wire','semantic','designs','predicates',
      'catalogue'].includes(args[0])) return 'wasm-code-generation';
  }
  return 'unclassified-execution';
}
export function observeCompilerPhase(program,args,started,success,artifact) {
  // Diagnostic loss cannot change the actual compiler or test outcome.
  try {
    const record=Buffer.from('# prismpm-compiler-phase ' + JSON.stringify({
      phase:compilerPhase(program,args,artifact),elapsed_ms:Math.ceil(performance.now()-started),success}) + '\n');
    if(record.length>256)return;
    // Pipes may briefly reject a write even while their reader is active.
    // Account for byte progress and yield on transient backpressure, with
    // fixed attempt/time bounds; never wait indefinitely for diagnostics.
    const deadline=performance.now()+100;
    let offset=0,wait=null;
    for(let attempt=0;attempt<64&&offset<record.length;attempt++) {
      if(performance.now()>=deadline)return;
      try {
        const written=writeSync(2,record,offset,record.length-offset);
        if(!Number.isSafeInteger(written)||written<=0||written>record.length-offset)return;
        offset+=written;
      } catch(error) {
        if(!['EINTR','EAGAIN','EWOULDBLOCK'].includes(error?.code))return;
        if(error.code!=='EINTR') {
          wait??=new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(wait,0,0,1);
        }
      }
    }
  }
  catch { /* No acceptance depends on this optional observation. */ }
}
function execute(program,args,cwd,env={},artifact) {
  const childEnvironment = compilerEnvironment(env);
  const tools = {cargo:'/usr/local/cargo/bin/cargo',rustc:'/usr/local/cargo/bin/rustc',
    lean:'/usr/local/elan/bin/lean',lake:'/usr/local/elan/bin/lake',node:process.execPath,tar:'/usr/bin/tar'};
  const executable = tools[program] ?? program;
  assert.ok(typeof executable === 'string' && executable.startsWith('/'),
    'compiler command must be SDK-owned or an exact generated executable');
  if (Object.hasOwn(env,'LEAN_PATH')) assert.ok(executable.endsWith('/prod-export'),
    'LEAN_PATH belongs only to the exact generated exporter');
  const started = performance.now(); let success = false;
  try {
    const result = spawnSync('/usr/bin/timeout',
      ['--signal=TERM','--kill-after=5s','360s',executable,...args],
      {cwd,detached:true,encoding:'utf8',timeout:370000,killSignal:'SIGKILL',
        maxBuffer:32*1024*1024,env:childEnvironment});
    terminateOwnedGroup(result.pid);
    assert.ifError(result.error);
    assert.equal(result.status,0,program+' '+args.join(' ')+'\n'+result.stdout+'\n'+result.stderr);
    success = true; return result.stdout;
  } finally {
    observeCompilerPhase(program,args,started,success,artifact);
  }
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
export function run(program,args,cwd,env={},artifact) {
  // Refuse overrides before even the tool-version subprocesses are executed.
  compilerEnvironment(env);
  if (!compilerToolsVerified) { verifyCompilerTools(); compilerToolsVerified = true; }
  return execute(program,args,cwd,env,artifact);
}

export function createPrivateDriverTarget(work) {
  assert.equal(realpathSync(work), resolve(work), 'aliased driver parent refused');
  const parent = lstatSync(work);
  assert.ok(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o077) === 0,
    'driver parent must be an owned private directory');
  const target = join(work, 'driver-target');
  // Cargo must initialize its own CACHEDIR.TAG. A private owning parent guards
  // this absent destination; an existing fingerprint cannot authenticate code.
  assert.equal(lstatSync(target, {throwIfNoEntry:false}), undefined, 'private driver target already exists');
  return target;
}
export function ensureProdExport(repo = repository, work = null) {
  const captured = verifyPins(repo);
  for (const name of ['lean-toolchain', 'rust-toolchain.toml']) {
    const bytes = sourceFile(repo, name);
    assert.deepEqual(bytes, sourceFile(repository, name), 'exporter uses the verified SDK toolchain');
    captured.set(name, bytes);
  }
  // A prior executable, Lake trace or caller-resealed receipt does not prove
  // source provenance. Never adopt, overwrite or execute the shared cache.
  assert.ok(typeof work === 'string', 'owned exporter workspace required');
  assert.equal(realpathSync(work), resolve(work), 'aliased exporter parent refused');
  const parent = lstatSync(work);
  assert.ok(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o077) === 0,
    'exporter parent must be an owned private directory');
  const dir = join(work, 'exporter');
  mkdirSync(dir, {mode:0o700});
  const archive = join(dir, '.source-lean.tar');
  writeFileSync(archive, captured.get('vendor/lean4-prod/lean.tar'), {flag:'wx', mode:0o600});
  // Archive modes describe upstream packaging, not this private executable
  // owner. Construct under an owner-only mask instead of chmod'ing an adopted
  // runtime after capture; restore the caller's mask even when construction fails.
  const previousMask = process.umask(0o077);
  try {
    run('tar', ['--no-same-owner', '--no-same-permissions', '-xf', archive, '-C', dir], dir);
    run('lake', ['build', 'prod-export'], dir);
  } finally { process.umask(previousMask); }
  const bin = join(dir, '.lake/build/bin/prod-export');
  sourceFile(dir, '.lake/build/bin/prod-export');
  for (const [name, bytes] of captured) assert.deepEqual(sourceFile(repo, name), bytes,
    'compiler source remained frozen: '+name);
  assert.deepEqual(readFileSync(archive), captured.get('vendor/lean4-prod/lean.tar'), 'captured exporter archive remained frozen');
  return { dir, bin };
}
export function prepare(mutation=null,compilerOwner=null){
  const started=performance.now();
  assert.ok([null,"session","rows"].includes(mutation),"closed negative-only model mutation");
  verifyPins();
  const shared=compilerOwner===null?null:requireCompilerOwner(compilerOwner,'view');
  const work=mkdtempSync(join(tmpdir(),'prismpm-view-'));
  let completed=false;
  try {
    const modules=['Foundation.Browser.V1.Workspace','Foundation.View.V1.Interaction','Foundation.View.Workspace.V1.Corpus','Foundation.View.Workspace.V1.Interaction','Foundation.View.Workspace.V1.Labels'];
    const sourcePath=name=>join(name.endsWith('.Labels')?draft:join(repository,'stdlib'),'src',...name.split('.'))+'.lex.tex';
    const sources=new Map(modules.map(name=>[name,readFileSync(sourcePath(name))]));
    const originalSources=new Map(sources);
    if(mutation){
      const name='Foundation.View.Workspace.V1.Interaction',text=sources.get(name).toString('utf8'),match=/\\semanticdata\{(.*)\}/.exec(text);assert.ok(match);
      const ast=JSON.parse(match[1]);
      if(mutation==='session'){const d=ast.declarations.find(d=>d.name==='interactionComplete'),node=d.body.branches[0].body.branches[0].body.scrutinee.value;assert.equal(node.left.function.name,'workspaceBytesEqual');node.left={kind:'bool',value:true};}
      else{const d=ast.declarations.find(d=>d.name==='interactionPresentation'),node=d.body.arguments[1].branches[0].body;assert.equal(node.arguments[1].function.name,'byteWindow');node.arguments[1]={kind:'bytes',hex:''};}
      const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      sources.set(name,Buffer.from(text.replace(match[0],'\\semanticdata{'+JSON.stringify(canonical(ast))+'}')));
    }
    const project=join(work,'project');
    for(const [name,bytes]of sources){const path=join(project,'src',...name.split('.'))+'.lex.tex';mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});}
    for(const file of ['lexlean.toml','lakefile.toml','lean-toolchain'])copyFileSync(join(draft,file),join(project,file));
    copyFileSync(join(repository,'rust-toolchain.toml'),join(work,'rust-toolchain.toml'));
    let invokeDriver;
    if(shared)invokeDriver=args=>shared.runDriver(args,repository);
    else{
      const driverTarget=createPrivateDriverTarget(work);
      run('cargo',['build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0','--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3','--manifest-path',join(draft,'driver/Cargo.toml')],repository,{CARGO_TARGET_DIR:driverTarget});
      const driver=join(driverTarget,'debug/browser-workspace-view-driver');
      invokeDriver=args=>run(driver,args,repository);
    }
    run('lake',['update'],project);
    const verified=JSON.parse(invokeDriver(['verify',join(project,'lexlean.toml')]));
    assert.deepEqual(verified.modules,modules);
    const lean=join(work,'lean');mkdirSync(lean);
    for(const name of modules){const relative=join('PrismPM',...name.split('.'))+'.lean',path=join(lean,relative);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(verified.root,'modules',relative),path);}
    copyFileSync(join(repository,'lean-toolchain'),join(lean,'lean-toolchain'));
    writeFileSync(join(lean,'lakefile.toml'),'name = "workspace_view_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['+modules.map(n=>'"PrismPM.'+n+'"').join(',')+']\n',{flag:'wx'});
    run('lake',['build','PrismGenerated'],lean);
    const exporter=shared?null:ensureProdExport(repository,work);
    const invokeExporter=args=>shared?shared.runExporter(args,join(lean,'.lake/build/lib/lean'))
      :run(exporter.bin,args,exporter.dir,{LEAN_PATH:join(lean,'.lake/build/lib/lean')});
    const exported=join(work,'export');
    invokeExporter(['--module','PrismPM.Foundation.View.Workspace.V1.Labels','--root','PrismPM.Foundation.View.Workspace.V1.Interaction.workspaceInteractionBytes','--root','PrismPM.Foundation.View.Workspace.V1.Interaction.workspacePresentationBytes','--root','PrismPM.Foundation.View.Workspace.V1.Labels.workspaceViewLabelsBytes','--ir-module','BrowserWorkspaceView','--out',exported]);
    const generated=join(work,'generated'),generation=JSON.parse(invokeDriver(['generate',join(exported,'kernel.ir'),generated,repository]));
    const runner=join(work,'runner');mkdirSync(join(runner,'src'),{recursive:true});copyFileSync(join(draft,'runner.rs'),join(runner,'src/main.rs'));
    writeFileSync(join(runner,'Cargo.lock'),'version = 4\n[[package]]\nname = "browser-workspace-view-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-workspace-view-runner"\nversion = "0.1.0"\ndependencies = ["browser-workspace-view-core-probe"]\n',{flag:'wx'});
    const nativeTarget=join(work,'native-target');
    function compileNative(standard){
      writeFileSync(join(runner,'Cargo.toml'),'[package]\nname = "browser-workspace-view-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-workspace-view-core-probe = {path = "../generated", default-features = '+standard+'}\n');
      run('cargo',['build','--locked','--offline','--release','--manifest-path',join(runner,'Cargo.toml')],runner,{CARGO_TARGET_DIR:nativeTarget});return join(nativeTarget,'release/browser-workspace-view-runner');
    }
    const wasm=[];
    for(const label of ['a','b']){
      const guest=join(work,'guest-'+label);assert.deepEqual(JSON.parse(invokeDriver(['generate-wasm',join(exported,'kernel.ir'),guest,repository])),generation);
      run('cargo',['build','--locked','--offline','--release'],guest,{CARGO_TARGET_DIR:join(guest,'target')});
      wasm.push(readFileSync(join(guest,'target/wasm32-unknown-unknown/release/browser_workspace_view_wasm_probe.wasm')));
    }
    assert.deepEqual(wasm[0],wasm[1],'two freshly generated and compiled guests');
    verifyPins();assert.equal(generation.ir_sha256,sha(readFileSync(join(exported,'kernel.ir'))));
    for(const [name,bytes]of originalSources)assert.deepEqual(bytes,readFileSync(sourcePath(name)),'source remained frozen '+name);
    if(shared)shared.verify();
    completed=true;return {work,sources,verified,generation,compileNative,runner,compilerOwner:shared?.identity??null,preparationMs:performance.now()-started,wasmBytes:wasm[0]};
  } finally {if(!completed)process.stderr.write('Retained incomplete View diagnostic build '+work+'\n');}
}
