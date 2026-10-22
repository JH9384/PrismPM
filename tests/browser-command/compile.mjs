import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const draft=dirname(fileURLToPath(import.meta.url));
export const repository=resolve(draft,'../..');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
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
export {ensureProdExport, run} from '../browser-journal/compile.mjs';
import {createPrivateDriverTarget, ensureProdExport, run} from '../browser-journal/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
export function prepare(){
  verifyPins();
  const work=mkdtempSync(join(tmpdir(),'prismpm-command-'));
  let completed=false;
  try {
  const files=['Workspace','WorkspaceCommand','WorkspaceCommandCorpus','WorkspaceEnvelope','WorkspaceJournal'];
  const sources=new Map(files.map(name=>[name,readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1',name+'.lex.tex'))]));
  for(const name of ['Workspace','WorkspaceEnvelope','WorkspaceJournal'])assert.deepEqual(sources.get(name),readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1',name+'.lex.tex')),'exact unchanged existing model '+name);
  assert.equal(sha(sources.get('Workspace')),'32e718bc606af3cd00703558ec4c1ecdcf1e69239e88adb6ad3a364e69aacc4e');
  assert.equal(sha(sources.get('WorkspaceEnvelope')),'ab5ca1097924ab1286c66cb7e8163ba9429153175c386b674af5e75f86f8855c');
  const project=join(work,'project'),sourceRoot=join(project,'src/Foundation/Browser/V1');mkdirSync(sourceRoot,{recursive:true});
  for(const [name,bytes]of sources)writeFileSync(join(sourceRoot,name+'.lex.tex'),bytes,{flag:'wx'});
  for(const file of ['lexlean.toml','lakefile.toml','lean-toolchain'])copyFileSync(join(draft,file),join(project,file));
  copyFileSync(join(repository,'rust-toolchain.toml'),join(work,'rust-toolchain.toml'));
  const driverTarget=createPrivateDriverTarget(work);
  run('cargo',['build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0','--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3','--manifest-path',join(draft,'driver/Cargo.toml')],repository,{CARGO_TARGET_DIR:driverTarget});
  const driver=join(driverTarget,'debug/browser-workspace-command-driver');
  run('lake',['update'],project);
  const verified=JSON.parse(run(driver,['verify',join(project,'lexlean.toml')],repository));
  assert.deepEqual(verified.modules,files.map(n=>'Foundation.Browser.V1.'+n));
  const lean=join(work,'lean'),leanSource=join(lean,'PrismPM/Foundation/Browser/V1');mkdirSync(leanSource,{recursive:true});
  for(const name of files)copyFileSync(join(verified.root,'modules/PrismPM/Foundation/Browser/V1',name+'.lean'),join(leanSource,name+'.lean'));
  copyFileSync(join(repository,'lean-toolchain'),join(lean,'lean-toolchain'));
  writeFileSync(join(lean,'lakefile.toml'),'name = "workspace_command_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['+files.map(n=>'"PrismPM.Foundation.Browser.V1.'+n+'"').join(',')+']\n',{flag:'wx'});
  run('lake',['build','PrismGenerated'],lean);
  const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
  const exported=join(work,'export');run(prodExport,['--module','PrismPM.Foundation.Browser.V1.WorkspaceCommand','--root','PrismPM.Foundation.Browser.V1.WorkspaceCommand.workspaceCommandBytes','--root','PrismPM.Foundation.Browser.V1.WorkspaceJournal.workspaceJournalBytes','--ir-module','BrowserWorkspaceCommand','--out',exported],exporter,{LEAN_PATH:join(lean,'.lake/build/lib/lean')});
  const generated=join(work,'generated');const generation=JSON.parse(run(driver,['generate',join(exported,'kernel.ir'),generated,repository],repository));
  const runner=join(work,'runner');mkdirSync(join(runner,'src'),{recursive:true});copyFileSync(join(draft,'runner.rs'),join(runner,'src/main.rs'));
  writeFileSync(join(runner,'Cargo.lock'),'version = 4\n[[package]]\nname = "browser-workspace-command-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-workspace-command-runner"\nversion = "0.1.0"\ndependencies = ["browser-workspace-command-core-probe"]\n',{flag:'wx'});
  const nativeTarget=join(work,'native-target');
  function compileNative(standard){writeFileSync(join(runner,'Cargo.toml'),'[package]\nname = "browser-workspace-command-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-workspace-command-core-probe = {path = "../generated", default-features = '+standard+'}\n');run('cargo',['build','--locked','--offline','--release','--manifest-path',join(runner,'Cargo.toml')],runner,{CARGO_TARGET_DIR:nativeTarget});return join(nativeTarget,'release/browser-workspace-command-runner');}
  const guest=join(work,'guest');assert.deepEqual(JSON.parse(run(driver,['generate-wasm',join(exported,'kernel.ir'),guest,repository],repository)),generation);run('cargo',['build','--locked','--offline','--release'],guest,{CARGO_TARGET_DIR:join(guest,'target')});
  const wasmBytes=readFileSync(join(guest,'target/wasm32-unknown-unknown/release/browser_workspace_command_wasm_probe.wasm'));
  const journalGuest=join(work,'journal-guest');assert.deepEqual(JSON.parse(run(driver,['generate-journal-wasm',join(exported,'kernel.ir'),journalGuest,repository],repository)),generation);run('cargo',['build','--locked','--offline','--release'],journalGuest,{CARGO_TARGET_DIR:join(journalGuest,'target')});
  const journalWasm=readFileSync(join(journalGuest,'target/wasm32-unknown-unknown/release/browser_workspace_command_wasm_probe.wasm'));
  verifyPins();assert.equal(generation.ir_sha256,sha(readFileSync(join(exported,'kernel.ir'))));
  for(const [name,bytes]of sources){const current=readFileSync(join(repository,'stdlib/src/Foundation/Browser/V1',name+'.lex.tex'));assert.equal(current.length,bytes.length,'source length changed '+name);assert.ok(current.equals(bytes),'source bytes changed '+name);}
  const cacheRetirement=retireCompletedCompilerCaches(work,'command');
  completed=true;
  return {work,sources,verified,generation,compileNative,runner,cacheRetirement,wasmBytes,journalWasm};
  } finally { if(!completed)rmSync(work,{recursive:true,force:true}); }
}
