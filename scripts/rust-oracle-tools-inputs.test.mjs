import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync,symlinkSync,linkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {toolStage,toolInputChanges} from './rust-oracle-tools-inputs.mjs';
const files=['.devcontainer/Dockerfile','sdk/Dockerfile','.github/workflows/rust-oracle-tools.yml',
  'scripts/sdk-image-inputs.test.mjs','scripts/sdk-image-inputs.mjs','scripts/sdk-vv-inputs.mjs','sdk/inventory-metadata.mjs',
  '.github/workflows/release.yml','.github/workflows/sdk-candidate.yml','scripts/vv.sh',
  'scripts/rust-oracle-tools-inputs.mjs','scripts/rust-oracle-tools-inputs.test.mjs'];
const originals=new Map(files.map(path=>[path,readFileSync(new URL('../'+path,import.meta.url),'utf8')]));
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'rust-tool-inputs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
    GIT_AUTHOR_NAME:'Tool input fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
    GIT_COMMITTER_NAME:'Tool input fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env,timeout:5000});
  const put=(path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);chmodSync(join(root,path),path==='scripts/vv.sh'?0o755:0o644);};
  git('init','--quiet');for(const [path,bytes] of originals)put(path,bytes);
  const commit=()=>{git('add','--all');git('commit','--quiet','-m','test: tool inputs');return git('rev-parse','HEAD').trim();};
  return {root,put,git,commit,base:commit()};
}
test('downstream-only changes do not claim new native tool qualification',t=>{
  for(const path of files.slice(0,2)) {
    const f=fixture(t);f.put(path,originals.get(path)+'\n# downstream-only change\n');f.commit();
    const result=toolInputChanges(f.root,f.base);assert.equal(result.changed,false);
    assert.equal(result.scope,'change-detection-only-not-qualification');
    assert.deepEqual(result.stages.map(row=>row.path),files.slice(0,2));
  }
});
test('untracked aliases and Git object mode substitutions cannot authorize a skip',t=>{
  for(const fault of ['untracked','symlink','mode','submodule','base-symlink','base-mode','base-submodule']) {
    const f=fixture(t),path=files[0];let base=f.base;
    if(fault==='untracked')f.git('rm','--cached',path);
    else if(fault.endsWith('symlink')) {
      rmSync(join(f.root,path));symlinkSync('../sdk/Dockerfile',join(f.root,path));
    }else if(fault.endsWith('mode'))chmodSync(join(f.root,path),0o755);
    else f.git('update-index','--cacheinfo',`160000,${f.base},${path}`);
    if(fault.startsWith('base-')) {
      if(fault==='base-submodule') {f.git('commit','--quiet','-m','test: gitlink substitution');base=f.git('rev-parse','HEAD').trim();}
      else base=f.commit();
      if(fault==='base-symlink')rmSync(join(f.root,path));
      f.put(path,originals.get(path));f.commit();
    }else if(fault==='symlink'||fault==='mode')f.commit();
    assert.throws(()=>toolInputChanges(f.root,base),fault);
  }
});
test('ambient Git redirection and configuration cannot replace the selected source',t=>{
  const f=fixture(t),planted={GIT_DIR:'/nonexistent-prism-git',GIT_WORK_TREE:'/nonexistent-prism-tree',
    GIT_INDEX_FILE:'/nonexistent-prism-index',GIT_OBJECT_DIRECTORY:'/nonexistent-prism-objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES:'/nonexistent-prism-alternates',GIT_CONFIG_PARAMETERS:'malformed',
    GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true'};
  const original=new Map(Object.keys(planted).map(key=>[key,process.env[key]]));
  try {Object.assign(process.env,planted);assert.equal(toolInputChanges(f.root,f.base).changed,false);}
  finally {for(const [key,value] of original)if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('actual classifier mutant and nonregular working inputs cannot invent unchanged inputs',async t=>{
  const f=fixture(t),path=files[0],source=originals.get('scripts/rust-oracle-tools-inputs.mjs');
  const guard='.some(row=>row.head_sha256!==row.base_sha256)';assert.equal(source.split(guard).length,2);
  const mutant=join(f.root,'mutant.mjs');writeFileSync(mutant,source.replace(guard,'.every(row=>row.head_sha256!==row.base_sha256)'));
  const changed=await import(pathToFileURL(mutant));
  f.put(path,originals.get(path).replace('ENV SOURCE_DATE_EPOCH=0','ENV SOURCE_DATE_EPOCH=1'));f.commit();
  assert.equal(toolInputChanges(f.root,f.base).changed,true);
  assert.throws(()=>assert.equal(changed.toolInputChanges(f.root,f.base).changed,true),assert.AssertionError);
  for(const fault of ['hardlink','fifo','working-symlink']) {
    const input=fixture(t),selected=join(input.root,path);
    if(fault==='hardlink')linkSync(selected,join(input.root,'alias'));
    else {rmSync(selected);if(fault==='fifo')execFileSync('mkfifo',[selected],{timeout:5000});else symlinkSync('../sdk/Dockerfile',selected);}
    assert.throws(()=>toolInputChanges(input.root,input.base),fault);
  }
});
test('every stage, syntax and qualification harness change requires both native builds',t=>{
  const stageChanges=[text=>text.replace('rust:1.97.1-bookworm','rust:1.97.2-bookworm'),
    text=>text.replace('sha256:0e2bcaef','sha256:1e2bcaef'),
    text=>text.replace('# syntax=docker/dockerfile:1.12','# syntax=docker/dockerfile:1.13'),
    text=>text.replace('# Keep this','\n# escape=`\n# Keep this'),
    text=>text.replace('ENV SOURCE_DATE_EPOCH=0','ENV SOURCE_DATE_EPOCH=1'),
    text=>text.replace('cargo install --locked','cargo install'),
    ...['0.2.122','1.258.0','48.0.1','0.2.12'].map(version=>text=>text.replace('--version '+version,'--version '+version+'0'))];
  for(const path of files.slice(0,2))for(const change of stageChanges) {
    const f=fixture(t),changed=change(originals.get(path));assert.notEqual(changed,originals.get(path));
    f.put(path,changed);f.commit();assert.equal(toolInputChanges(f.root,f.base).changed,true);
  }
  for(const path of files.slice(2)) {
    const f=fixture(t);f.put(path,originals.get(path)+'\n// changed harness\n');f.commit();
    assert.equal(toolInputChanges(f.root,f.base).changed,true);
  }
  const f=fixture(t);for(const path of files.slice(0,2))f.put(path,stageChanges[2](originals.get(path)));
  f.commit();assert.equal(toolInputChanges(f.root,f.base).changed,true);
});
test('missing base, dirty inputs and malformed stage cannot authorize a skip',t=>{
  const f=fixture(t);assert.throws(()=>toolInputChanges(f.root,'f'.repeat(40)));
  assert.throws(()=>toolInputChanges(f.root,'main'));assert.equal(toolInputChanges(f.root).changed,true);
  f.put(files[0],originals.get(files[0])+'\n# dirty\n');assert.throws(()=>toolInputChanges(f.root,f.base));
  for(const text of ['FROM rust AS rust_oracle_tools\n',originals.get(files[0]).replace(' AS rust_oracle_tools',' AS other'),
    originals.get(files[0])+'\nFROM duplicate AS rust_oracle_tools\n'])assert.throws(()=>toolStage(text));
  const added=fixture(t),path='scripts/rust-oracle-tools-inputs.test.mjs';
  added.git('rm',path);const base=added.commit();added.put(path,originals.get(path));added.commit();
  assert.equal(toolInputChanges(added.root,base).changed,true,'new qualification dependency requires real builds');
});
test('first rollout binds complete legacy and mixed base recipes and requires native construction',t=>{
  const legacy=path=>{
    const image=originals.get(path).split('\n').find(line=>/^FROM \S+@sha256:[0-9a-f]{64}/u.test(line));
    assert(image);
    return `${image.replace(/ AS \S+$/u,' AS legacy')}\nRUN printf '%s\\n' legacy-tool-installation\n`;
  };
  for(const selected of [[files[0]],[files[1]],files.slice(0,2)]) {
    const f=fixture(t);
    for(const path of selected)f.put(path,legacy(path));
    const base=f.commit();
    for(const path of selected)f.put(path,originals.get(path));
    f.commit();const result=toolInputChanges(f.root,base);
    assert.equal(result.changed,true);
    assert.equal(result.scope,'change-detection-only-not-qualification');
    assert.equal(result.base_revision,base);
    for(const row of result.stages) {
      const bytes=selected.includes(row.path)?legacy(row.path):toolStage(originals.get(row.path));
      assert.equal(row.base_sha256,createHash('sha256').update(bytes).digest('hex'));
      assert.equal(row.head_sha256,createHash('sha256').update(toolStage(originals.get(row.path))).digest('hex'));
    }
  }
});
test('legacy transition never accepts malformed declared stages, unknown recipes or invalid source identities',async t=>{
  for(const prior of ['unrecognized recipe\n',
    originals.get(files[0]).replace(' AS rust_oracle_tools',' AS RUST_ORACLE_TOOLS'),
    originals.get(files[0])+'\nFROM duplicate AS rust_oracle_tools\n',
    originals.get(files[0]).replace(/^# syntax=[^\n]+\n/u,''),
    'x'.repeat(256*1024+1)]) {
    const f=fixture(t);f.put(files[0],prior);const base=f.commit();
    f.put(files[0],originals.get(files[0]));f.commit();
    assert.throws(()=>toolInputChanges(f.root,base));
  }
  const invalid=fixture(t);
  invalid.put(files[0],Buffer.from([0xff]));const base=invalid.commit();
  invalid.put(files[0],originals.get(files[0]));invalid.commit();
  assert.throws(()=>toolInputChanges(invalid.root,base));
  const missing=fixture(t);missing.git('rm',files[0]);const absent=missing.commit();
  missing.put(files[0],originals.get(files[0]));missing.commit();
  assert.throws(()=>toolInputChanges(missing.root,absent));
  const malformedHead=fixture(t);
  malformedHead.put(files[0],originals.get(files[0]).replace(' AS rust_oracle_tools',' AS other'));
  malformedHead.commit();assert.throws(()=>toolInputChanges(malformedHead.root,malformedHead.base));
  const f=fixture(t),path=files[0];
  const image=originals.get(path).split('\n').find(line=>/^FROM \S+@sha256:[0-9a-f]{64}/u.test(line));
  assert(image);const legacy=`${image.replace(/ AS \S+$/u,' AS legacy')}\n`;
  f.put(path,legacy);const legacyBase=f.commit();f.put(path,originals.get(path));f.commit();
  const source=originals.get('scripts/rust-oracle-tools-inputs.mjs');
  const guard='previous=prior;legacyBase=true;';assert.equal(source.split(guard).length,2);
  const mutant=join(f.root,'legacy-mutant.mjs');
  writeFileSync(mutant,source.replace(guard,'previous=current;legacyBase=false;'));
  const changed=await import(pathToFileURL(mutant));
  const expected=toolInputChanges(f.root,legacyBase),actual=changed.toolInputChanges(f.root,legacyBase);
  assert.equal(expected.changed,true);
  const originalHash=createHash('sha256').update(legacy).digest('hex');
  assert.equal(expected.stages[0].base_sha256,originalHash);
  assert.throws(()=>assert.equal(actual.changed,true),assert.AssertionError);
  assert.throws(()=>assert.equal(actual.stages[0].base_sha256,originalHash),assert.AssertionError);
});
test('heredoc and escaped logical-line ambiguity binds the complete recipe',()=>{
  for(const replacement of ['RUN cat <<EOF\nFROM literal-data\nEOF\nENV SOURCE_DATE_EPOCH=0',
    'ENV SOURCE_DATE_EPOCH=0 \\\nFROM literal-continuation',
    'ENV SOURCE_DATE_EPOCH=0 `\nFROM literal-continuation']) {
    const recipe=originals.get(files[0]).replace('ENV SOURCE_DATE_EPOCH=0',replacement);
    assert.equal(toolStage(recipe),recipe);
  }
});
test('actual workflow keeps source tests unconditional and the complete native gate conditional',()=>{
  const original=originals.get('.github/workflows/rust-oracle-tools.yml');
  const check=source=>{
    assert.equal(source.split("if: steps.inputs.outputs.changed == 'true'").length,3);
    const start=source.indexOf('      - name: Validate source and acquisition boundary');
    const end=source.indexOf('      - name: Build both exact tool stages',start);
    assert(start>=0&&end>start);
    const validation=source.slice(start,end);assert(!validation.includes('if:'));
    assert(validation.includes('node --test scripts/sdk-image-inputs.test.mjs'));
    const gate=source.slice(end,source.indexOf('      - uses: actions/upload-artifact',end));
    assert(gate.includes("if: steps.inputs.outputs.changed == 'true'"));
    assert.equal(gate.split('--target rust_oracle_tools').length,3);
    for(const point of ['assert.equal(steps.length, 4','${id} CACHED','development.sha256 target/rust-oracle-tools/sdk.sha256',
      'cargo-local-registry','wasm-bindgen-test-runner','wasm2es6js','wasm-tools','wasmtime','--network none --read-only'])assert(gate.includes(point));
    assert(source.includes('native construction not run; no qualification established.'));
  };
  check(original);
  for(const mutant of [original.replace("if: steps.inputs.outputs.changed == 'true'","if: steps.inputs.outputs.changed == 'false'"),
    original.replace('node --test scripts/sdk-image-inputs.test.mjs','true'),
    original.replace('assert.equal(steps.length, 4','assert.equal(steps.length, 3')])assert.throws(()=>check(mutant));
});
test('actual tool verifier requires fresh construction before within-job reuse',t=>{
  const workflow=originals.get('.github/workflows/rust-oracle-tools.yml');
  const start=workflow.indexOf("          import assert from 'node:assert/strict';");
  const end=workflow.indexOf('\n          JS',start);
  assert(start>=0&&end>start);
  const verifier=workflow.slice(start,end).replace(/^          /gm,'');
  const root=mkdtempSync(join(tmpdir(),'rust-tool-construction-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'target/rust-oracle-tools'),{recursive:true});
  const trace=cached=>Array.from({length:4},(_,index)=>{
    const id=`#${index+10}`;
    return `${id} [rust_oracle_tools ${index+2}/5] RUN cargo install --locked --root /opt/prismpm/rust-oracle-tools tool-${index}\n${id} ${cached?'CACHED':'DONE 123.4s'}`;
  }).join('\n');
  const run=(development,sdk)=>{
    for(const [image,log] of [['development',development],['sdk',sdk]])
      writeFileSync(join(root,`target/rust-oracle-tools/${image}.log`),log);
    return execFileSync(process.execPath,['--input-type=module','--eval',verifier],
      {cwd:root,encoding:'utf8',timeout:5000,stdio:'pipe'});
  };
  const cold=trace(false),warm=trace(true);
  run(cold,warm);
  for(const [development,sdk] of [[warm,warm],[cold,cold],[cold.replace('#10 DONE 123.4s','#10 ERROR failed'),warm],
    [cold,warm.replace('#10 CACHED','#10 DONE 1.0s')],[cold.replaceAll('#11','#10'),warm],
    [cold.split('\n').slice(0,-2).join('\n'),warm],[cold,'']])
    assert.throws(()=>run(development,sdk));
  const check=source=>{
    const gate=source.slice(source.indexOf('      - name: Build both exact tool stages'),source.indexOf('      - uses: actions/upload-artifact'));
    assert.equal(gate.split('--no-cache-filter rust_oracle_tools').length,2);
    assert(gate.indexOf('--no-cache-filter rust_oracle_tools')<gate.indexOf('--file .devcontainer/Dockerfile'));
    assert(!source.includes('actions/cache@'),'untrusted cross-run tool caches cannot substitute fresh construction');
    assert(!gate.includes('--cache-from'),'external executable cache cannot substitute fresh construction');
    assert(gate.includes("[['development', false], ['sdk', true]]"));
  };
  check(workflow);
  for(const mutant of [workflow.replace(' --no-cache-filter rust_oracle_tools',''),
    workflow.replace('--file .devcontainer/Dockerfile','--cache-from type=gha --file .devcontainer/Dockerfile'),
    workflow+'\n      - uses: actions/cache@untrusted\n',
    workflow.replace("[['development', false], ['sdk', true]]","[['sdk', true]]")])
    assert.throws(()=>check(mutant));
});
