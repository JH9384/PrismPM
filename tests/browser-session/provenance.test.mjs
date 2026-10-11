// Source-custody checks only; the complete generated owner remains mandatory.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {chmodSync,copyFileSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {provenanceProfile,presentationOutputRows} from '../browser-presentation/provenance.mjs';
import {modules,frozenInputs,assertFrozenInputs,repository,sha} from './compile.mjs';
import {sourceRoots,suites} from '../../scripts/browser-api-sdk-check.mjs';

test('session provenance admits only the registered complete family, never a caller subset',()=>{
  for(const value of [null,[],{},'','session/../presentation','caller-family',
    {toString(){throw Error('coercion');}}])
    assert.throws(()=>provenanceProfile(value),/registered complete provenance family/);
  const profile=provenanceProfile('session');
  assert.deepEqual(profile.outputRows.filter(row=>row.kind==='lean').map(row=>
    row.path.slice('modules/PrismPM/'.length,-'.lean'.length).replaceAll('/','.')),modules);
  assert.equal(profile.outputRows.length,50);
  assert.deepEqual(provenanceProfile('presentation').outputRows,presentationOutputRows);
  assert.equal(presentationOutputRows.length,30);
  assert.throws(()=>{profile.outputRows.pop();},TypeError);
  assert.throws(()=>{profile.outputRows[0].path='omitted';},TypeError);
});

test('session frozen input authority cannot be forged by copying coherent hash labels',()=>{
  const inputs=frozenInputs();
  assertFrozenInputs(inputs);
  assert.throws(()=>assertFrozenInputs({...inputs}),/actual frozen session input closure/);
  for(const path of Object.keys(inputs))
    assert.ok(sourceRoots.some(root=>path===root||path.startsWith(root+'/')),
      'installed SDK covers complete session owner input '+path);
});

test('every session barrier freshly checks original file custody and manifest membership',async t=>{
  const root=mkdtempSync(join(tmpdir(),'prismpm-session-input-custody-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const original=frozenInputs();
  for(const path of Object.keys(original)){
    const destination=join(root,path);mkdirSync(dirname(destination),{recursive:true});
    copyFileSync(join(repository,path),destination);
  }
  const isolated=await import(pathToFileURL(join(root,'tests/browser-session/compile.mjs')).href);
  const observe=()=>{const inputs=isolated.frozenInputs();isolated.assertFrozenInputs(inputs);return inputs;};
  const first=observe(),member='tests/browser-session/runner.rs',path=join(root,member);
  for(const forged of [Object.freeze({...first}),Object.freeze({...first,[member]:'0'.repeat(64)}),
    Object.freeze(Object.fromEntries(Object.entries(first).filter(([key])=>key!==member)))])
    assert.throws(()=>isolated.assertFrozenInputs(forged),/actual frozen session input closure/);
  const bytes=readFileSync(path),mode=lstatSync(path).mode&0o777;
  for(const kind of ['content','deleted','inode','mode','hardlink','symlink']){
    const inputs=observe(),saved=path+'.original';
    try{
      if(kind==='content')writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')]));
      if(kind==='mode')chmodSync(path,mode^0o040);
      if(['deleted','inode','hardlink','symlink'].includes(kind)){
        renameSync(path,saved);
        if(kind==='inode')copyFileSync(saved,path);
        if(kind==='hardlink')linkSync(saved,path);
        if(kind==='symlink')symlinkSync(saved,path);
      }
      assert.throws(()=>isolated.assertFrozenInputs(inputs),undefined,'actual '+kind+' substitution');
    }finally{
      if(['deleted','inode','hardlink','symlink'].includes(kind)){
        if(kind!=='deleted')unlinkSync(path);
        renameSync(saved,path);
      }else {writeFileSync(path,bytes);chmodSync(path,mode);}
    }
  }
  // Coherently re-pinning changed vendor bytes must not replace the ORIGINAL
  // lifetime capture, even when a new capture accepts the changed pin set.
  const manifestPath=join(root,'vendor/lexlean/MANIFEST.sha256');
  const dependenciesPath=join(root,'model/dependencies.toml');
  const manifest=readFileSync(manifestPath,'utf8'),dependencies=readFileSync(dependenciesPath,'utf8');
  const [,digest,vendorMember]=/^([0-9a-f]{64})  (.+)$/m.exec(manifest);
  const vendorPath=join(root,'vendor/lexlean',vendorMember),vendorBytes=readFileSync(vendorPath);
  for(const kind of ['changed-member','added-member']){
    const inputs=observe(),added=join(root,'vendor/lexlean/custody-added-input');
    try{
      let changed;
      if(kind==='changed-member'){
        const next=Buffer.concat([vendorBytes,Buffer.from('\n')]);writeFileSync(vendorPath,next);
        changed=manifest.replace(digest+'  '+vendorMember,sha(next)+'  '+vendorMember);
      }else {
        writeFileSync(added,'new manifest member\n',{flag:'wx'});
        changed=manifest+sha(readFileSync(added))+'  custody-added-input\n';
      }
      writeFileSync(manifestPath,changed);
      const oldPin='sha256 = "'+sha(Buffer.from(manifest))+'"';assert(dependencies.includes(oldPin));
      writeFileSync(dependenciesPath,dependencies.replace(oldPin,'sha256 = "'+sha(Buffer.from(changed))+'"'));
      observe();
      assert.throws(()=>isolated.assertFrozenInputs(inputs),/custody/,'coherent '+kind+' must refuse original capture');
    }finally{
      writeFileSync(vendorPath,vendorBytes);writeFileSync(manifestPath,manifest);
      writeFileSync(dependenciesPath,dependencies);
      if(kind==='added-member')unlinkSync(added);
    }
  }
  for(const tree of ['vendor/lean4-prod/rust','vendor/lexlean']) {
    const line='tree_root = "'+tree+'"\n';assert.equal(dependencies.split(line).length,2);
    for(const replacement of ['', 'tree_root = "vendor/unregistered"\n']) {
      try {
        writeFileSync(dependenciesPath,dependencies.replace(line,replacement));
        assert.throws(()=>isolated.frozenInputs(),/registered session pin tree/,
          'missing or changed tree cannot omit the fixed vendor member inventory');
      } finally {writeFileSync(dependenciesPath,dependencies);}
    }
  }
  const inputs=observe();isolated.assertFrozenInputs(inputs);
  writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')]));
  assert.throws(()=>isolated.assertFrozenInputs(inputs),/custody/,'success cannot memoize the next barrier');
  writeFileSync(path,bytes);
  // Change an already-captured manifest from a later real descriptor read.
  // Its old captured bytes still satisfy the pin, but its final name must not.
  const laterMember=Object.keys(original).filter(name=>name.startsWith('vendor/lexlean/')&&
    name>'vendor/lexlean/MANIFEST.sha256').at(-1);
  assert.ok(laterMember,'actual member ordered after its manifest at both captures');
  for(const phase of ['initial','barrier']) {
    const inputs=observe(),open=fs.openSync,read=fs.readSync,descriptors=new Map();
    let changed=false;
    try {
      fs.openSync=function(name,...args) {
        const fd=open(name,...args);descriptors.set(fd,name);return fd;
      };
      fs.readSync=function(fd,...args) {
        const count=read(fd,...args);
        if(!changed&&count>0&&descriptors.get(fd)===join(root,laterMember)) {
          changed=true;writeFileSync(manifestPath,manifest+'\n');
        }
        return count;
      };
      syncBuiltinESMExports();
      assert.throws(()=>phase==='initial'?isolated.frozenInputs():isolated.assertFrozenInputs(inputs),
        /stable final session custody/,'early captured member changed during later '+phase+' read');
      assert.equal(changed,true,'actual later descriptor read triggered the substitution');
    } finally {
      fs.openSync=open;fs.readSync=read;syncBuiltinESMExports();writeFileSync(manifestPath,manifest);
    }
  }
  const compilerPath=join(root,'tests/browser-session/compile.mjs'),compiler=readFileSync(compilerPath,'utf8');
  const check='for (const [path,evidence] of captured) bytes.set(path,capturedFile(join(repository,path),evidence));';
  assert.equal(compiler.split(check).length,2,'one actual per-member barrier to mutate');
  const finalCheck='assertCapturedNames(captured);';
  assert.equal(compiler.split(finalCheck).length,2,'one final name barrier to mutate');
  const mutantPath=join(root,'tests/browser-session/compile-omitted-custody.mjs');
  writeFileSync(mutantPath,compiler.replace(check,
    'for (const [path,evidence] of captured) if(path!=="tests/browser-session/runner.rs") bytes.set(path,capturedFile(join(repository,path),evidence));')
    .replace(finalCheck,'assertCapturedNames(new Map([...captured].filter(([path])=>path!=="tests/browser-session/runner.rs")));'),{flag:'wx'});
  const mutant=await import(pathToFileURL(mutantPath).href),mutantInputs=mutant.frozenInputs();
  mutant.assertFrozenInputs(mutantInputs);
  writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')]));
  const mustReject=()=>assert.throws(()=>mutant.assertFrozenInputs(mutantInputs),/custody/);
  assert.throws(mustReject,/Missing expected exception/,'the real changed-member assertion kills an omitted-check mutant');
});

test('source and installed session registration retain the entire original owner and added custody checks',()=>{
  const owner=suites.find(row=>row.id==='DK-26');
  assert.deepEqual(owner.files,['sdk/browser/session-model-test.mjs',
    'tests/browser-session/wire.test.mjs','tests/browser-session/provenance.test.mjs']);
  assert.equal(owner.minimum,39);assert.equal(owner.deadline,3600000);
});

test('session pins validate the same once-captured bytes at every fresh barrier',()=>{
  const open=fs.openSync, raw=fs.readFileSync;
  let opened=new Map();
  try {
    fs.openSync=function(path,...args) {
      assert.equal(typeof path,'string');
      assert.ok(path.startsWith(repository+'/'),'only registered repository sources are captured');
      opened.set(path,(opened.get(path)??0)+1);return open(path,...args);
    };
    fs.readFileSync=()=>{throw Error('raw pin reads cannot validate different bytes from the stable descriptor');};
    syncBuiltinESMExports();
    const inputs=frozenInputs(), paths=Object.keys(inputs).map(path=>join(repository,path));
    const verifyReads=()=>{
      assert.deepEqual([...opened.keys()].sort(),[...paths].sort(),'complete original input inventory actually read');
      assert.ok([...opened.values()].every(count=>count===1),'one stable descriptor capture per path per barrier');
    };
    verifyReads();
    for(let barrier=0;barrier<2;barrier++) {
      opened=new Map();assertFrozenInputs(inputs);verifyReads();
    }
  } finally {fs.openSync=open;fs.readFileSync=raw;syncBuiltinESMExports();}
});
