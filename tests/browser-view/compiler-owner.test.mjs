import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from './compiler-owner.mjs';
import {compilerDriverDirectory} from './compiler-owner-checks.mjs';

test('driver substitution lookup includes the two registered private families and rejects missing or ambiguous source inventory', () => {
  for (const directory of ['browser-view', 'browser-custody']) {
    const path = 'tests/' + directory + '/driver/src/main.rs';
    assert.equal(compilerDriverDirectory({[path]: 'not-authority'}), 'tests/' + directory + '/driver');
  }
  for (const paths of [[], ['tests/browser-p123/driver/src/main.rs'],
    ['tests/browser-view/driver/src/main.rs', 'tests/browser-custody/driver/src/main.rs']])
    assert.throws(() => compilerDriverDirectory(Object.fromEntries(paths.map(path => [path, 'not-authority']))),
      /one source-bound family driver/);
});

test('verification-only source reads retain the complete descriptor and digest checks without whole-file buffers', t => {
  const root=fs.mkdtempSync(join(tmpdir(),'prismpm-source-stream-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const path=join(root,'source'),bytes=Buffer.alloc(1024*1024,97);
  fs.writeFileSync(path,bytes,{mode:0o600});
  const source=fs.readFileSync(new URL('./compiler-owner.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('function unchanged(before, after) {');
  const end=source.indexOf('\n// A bounded filesystem observation',begin);
  assert(begin>=0&&end>begin);
  const allocations=[],alloc=Buffer.alloc.bind(Buffer);
  const measuredBuffer={alloc(size){allocations.push(size);return alloc(size);}};
  const file=runInNewContext(source.slice(begin,end)+'\nfile;',
    {...fs,assert,createHash,Buffer:measuredBuffer});
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(file(path,digest,false),undefined);
  assert(Math.max(...allocations)<=65536,'verification streams rather than retaining the entire file');
  assert.deepEqual(Buffer.from(file(path,digest)),bytes,'actual staging still receives the complete source bytes');
  assert.throws(()=>file(path,'0'.repeat(64),false),/captured compiler source/);
  fs.appendFileSync(path,'changed');
  assert.throws(()=>file(path,digest,false),/captured compiler source/);
  fs.writeFileSync(path,bytes);
  const alias=join(root,'alias');fs.linkSync(path,alias);
  assert.throws(()=>file(path,digest,false),/single-link/);
  fs.unlinkSync(alias);fs.symlinkSync(path,alias);
  assert.throws(()=>file(alias,digest,false),/unaliased/);
  for(const anchor of ['file(join(repository, path), digest, false)', 'file(join(work, path), digest, false)'])
    assert.equal(source.split(anchor).length,2,'both actual verification loops select streaming checks');
});

test('compiler owner refuses forged handles and unregistered tool families', () => {
  for (const value of [null, {}, {runDriver() {}, runExporter() {}, verify() {}}])
    assert.throws(() => requireCompilerOwner(value, {}), /actual fresh compiler owner/);
  for (const name of ['', '../escape', 'caller-driver', null, {toString() {throw Error('coercion');}}])
    assert.throws(() => createCompilerOwner(name, {}), /registered compiler family/);
});

test('fresh independent drivers pin hash optimization without changing construction or acceptance',()=>{
  // Construction-argument unit only. Full owning executions remain required.
  const source=fs.readFileSync(new URL('./compiler-owner.mjs',import.meta.url),'utf8');
  const begin=source.indexOf("    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',");
  const end=source.indexOf('\n    const driverBuildMs',begin);
  assert(begin>=0&&end>begin);const calls=[];
  runInNewContext(source.slice(begin,end),{run(...args){calls.push(args);},join,
    work:'/actual-private-owner',manifest:'driver/Cargo.toml',target:'/actual-fresh-target'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['cargo',[
    'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
    '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
    '--manifest-path','/actual-private-owner/driver/Cargo.toml'],
    '/actual-private-owner',{CARGO_TARGET_DIR:'/actual-fresh-target'}]]);
  for(const family of ['view','command','query']){
    const source=fs.readFileSync(new URL('../browser-'+family+'/compile.mjs',import.meta.url),'utf8');
    const begin=source.indexOf("run('cargo',['build','--locked','--offline','--jobs','1',");
    const suffix="],repository,{CARGO_TARGET_DIR:driverTarget});";
    const end=source.indexOf(suffix,begin);
    assert(begin>=0&&end>begin,'actual fallback construction '+family);
    const calls=[];
    runInNewContext(source.slice(begin,end+suffix.length),{run(...args){calls.push(args);},join,
      draft:'/actual-source/tests/browser-'+family,repository:'/actual-source',driverTarget:'/actual-fresh-'+family});
    assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['cargo',[
      'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
      '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
      '--manifest-path','/actual-source/tests/browser-'+family+'/driver/Cargo.toml'],
      '/actual-source',{CARGO_TARGET_DIR:'/actual-fresh-'+family}]]);
  }
  const remaining = [
    {path:'tests/browser-journal/compile.mjs',manifest:'/actual-draft/driver/Cargo.toml',cwd:'/actual-source'},
    ...['custody','effects','presentation','operation-journal']
      .map(family=>({path:'tests/browser-'+family+'/compile.mjs',manifest:'/captured-compiler/Cargo.toml',cwd:'/actual-work'})),
    {path:'tests/browser-budget/compile.mjs',manifest:'/captured-compiler/Cargo.toml',cwd:'/actual-work',target:'/actual-work/driver-target'},
    {path:'tests/publication-admission/compile.mjs',manifest:'/captured-compiler/Cargo.toml',cwd:'/actual-work',target:'/actual-work/driver-target'},
    {path:'sdk/browser/workspace-model-test.mjs',manifest:'/actual-source/tests/browser-workspace/Cargo.toml',cwd:'/actual-source'},
    {path:'sdk/browser/envelope-model-test.mjs',manifest:'/actual-fixture/driver/Cargo.toml',cwd:'/actual-source'},
  ];
  assert.equal(remaining.length,9);assert.equal(new Set(remaining.map(row=>row.path)).size,9);
  for(const row of remaining){
    const source=fs.readFileSync(new URL('../../'+row.path,import.meta.url),'utf8');
    const check = text => {
      const fresh=['tests/browser-budget/compile.mjs','tests/publication-admission/compile.mjs'].includes(row.path)
        ? /const driverTarget\s*=\s*join\(work,\s*'driver-target'\)/
        : row.program ? /const target\s*=\s*createPrivateDriverTarget\(work\)/
        : /const driverTarget\s*=\s*createPrivateDriverTarget\(work\)/;
      assert.match(text,fresh,'original fresh owned target '+row.path);
      const calls=[];
      const selected=[...text.matchAll(/run\((?:'cargo'|toolchain\.programs\.cargo\.path),\s*\['build',\s*'--locked',\s*'--offline',\s*'--jobs',\s*'1',[\s\S]*?\],\s*(?:repository|work),\s*\{CARGO_TARGET_DIR:\s*(?:driverTarget|target)\}\)/g)];
      assert.equal(selected.length,1,'one actual private driver construction '+row.path);
      runInNewContext(selected[0][0],{run(...args){calls.push(args);},join,
        compiler:{manifest:'/captured-compiler/Cargo.toml'},manifest:'/captured-manifest/Cargo.toml',
        draft:'/actual-draft',fixture:'/actual-fixture',repository:'/actual-source',work:'/actual-work',
        driverTarget:row.target??'/actual-fresh-target',target:'/actual-owned-target',toolchain:{programs:{cargo:{path:'/pinned-cargo'}}}});
      assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[row.program??'cargo',[
        'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
        '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
        '--manifest-path',row.manifest],row.cwd,{CARGO_TARGET_DIR:row.target??'/actual-fresh-target'}]]);
    };
    check(source);
    const setting=/'--config',\s*'profile\.dev\.package\.sha2\.opt-level=3'/;
    assert.equal([...source.matchAll(new RegExp(setting.source,'g'))].length,1);
    for(const replacement of ['',"'--config', 'profile.dev.package.sha2.opt-level=2'",
      "'--config', 'profile.dev.opt-level=3'","'--config', 'profile.test.package.sha2.opt-level=3'",
      "$&,$&","$&,'--config','profile.dev.package.sha2.opt-level=0'"]){
      const changed=source.replace(setting,replacement);assert.notEqual(changed,source);
      assert.throws(()=>check(changed),row.path+': '+replacement);
    }
    for(const [from,to]of [["'--locked'","'REMOVED'"],["'--offline'","'REMOVED'"],
      ["'--jobs', '1'","'--jobs', '2'"],["'profile.dev.debug=0'","'profile.dev.debug=2'"],
      ["'build.incremental=false'","'build.incremental=true'"]]){
      const expression=new RegExp(from.replaceAll('.', '\\.').replaceAll(', ', ',\\s*'));
      const changed=source.replace(expression,to);assert.notEqual(changed,source);
      assert.throws(()=>check(changed),row.path+': '+from);
    }
    const changed=source.replace(['tests/browser-budget/compile.mjs','tests/publication-admission/compile.mjs'].includes(row.path)
      ? "join(work, 'driver-target')" : 'createPrivateDriverTarget(work)', "'/unproved-shared-target'");
    assert.notEqual(changed,source);assert.throws(()=>check(changed),row.path+': fresh target substitution');
  }
});

test('compiler owner refuses malformed or incomplete input closures before building', () => {
  let called = false;
  const accessor = {get malicious() {called = true; return '0'.repeat(64);}};
  for (const inputs of [null, [], accessor, {'../escape': '0'.repeat(64)},
    {'vendor/lexlean/MANIFEST.sha256': 'invalid'}, {'a': null}, {'a': 42}, {}])
    assert.throws(() => createCompilerOwner('view', inputs),
      /compiler input (map|path|digest|closure)/);
  assert.equal(called, false, 'input accessors cannot run before immutable capture');
  for (const name of ['view', 'custody']) {
    const inputs = captureCompilerInputs(name);
    for (const missing of ['tests/browser-view/compile.mjs', 'tests/browser-view/compiler-artifact.mjs', 'vendor/lean4-prod/lean.tar']) {
      const changed = {...inputs}; delete changed[missing];
      assert.throws(() => createCompilerOwner(name, changed), /complete closed compiler input closure/);
    }
    assert.throws(() => createCompilerOwner(name, {...inputs, unexpected: '0'.repeat(64)}), /complete closed compiler input closure/);
  }
});
