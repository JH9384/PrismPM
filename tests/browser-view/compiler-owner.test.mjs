import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from './compiler-owner.mjs';
import {compilerDriverDirectory} from './compiler-owner-checks.mjs';
import {captureVerificationProducts} from './verification-products.mjs';
import {withCompilerOwner} from './serial-compiler-owner.mjs';

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

test('all five existing adapters reject forged owners before any construction', async () => {
  for (const family of ['effects', 'presentation', 'operation-journal', 'budget', 'publication']) {
    const path = family === 'publication' ? '../publication-admission/compile.mjs' : '../browser-' + family + '/compile.mjs';
    const {prepare} = await import(path);
    for (const forged of [{}, {runDriver() {}, runExporter() {}, verify() {}}]) {
      const args = family === 'operation-journal' ? [null, false, forged]
        : ['budget', 'publication'].includes(family) ? [null, undefined, forged] : [null, forged];
      assert.throws(() => prepare(...args), /actual fresh compiler owner/, family);
    }
  }
});

test('five-family serial entry points reject unknown families without constructing tools', async () => {
  for (const family of ['', 'view', 'custody', 'session', 'p256', '../escape', null])
    await assert.rejects(withCompilerOwner({}, family, () => {}), /existing serial compiler family/);
  for (const directory of ['browser-effects', 'browser-presentation', 'browser-operation-journal', 'browser-budget', 'publication-admission']) {
    const path = 'tests/' + directory + '/driver/src/main.rs';
    assert.equal(compilerDriverDirectory({[path]: 'not-authority'}), 'tests/' + directory + '/driver');
  }
  for (const directory of ['browser-session', 'browser-p256', 'holo-primary-component', 'publication-context-linkage'])
    assert.throws(() => compilerDriverDirectory({['tests/' + directory + '/driver/src/main.rs']: 'not-authority'}), /one source-bound family driver/);
});

test('five existing adapters preserve exact driver and exporter arguments across shared-tool dispatch', () => {
  // Argument-boundary unit only; no recorder is compiler or SDK evidence.
  for (const family of ['effects', 'presentation', 'operation-journal', 'budget', 'publication']) {
    const path = family === 'publication' ? '../publication-admission/compile.mjs' : '../browser-' + family + '/compile.mjs';
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const check = text => {
      assert(text.includes("requireCompilerOwner(compilerOwner, '" + family + "')"));
      const begin = text.indexOf('    let compiler, invokeDriver;');
      const end = text.indexOf('\n    }', begin);
      assert(begin >= 0 && end > begin, 'one shared/fresh driver construction branch');
      const driver = text.slice(begin, end + '\n    }'.length);
      const observed = [];
      const shared = {runDriver(...args) {observed.push(['driver', ...args]);}};
      const invoke = runInNewContext(driver + '\ninvokeDriver;', {
        shared, join, work:'/actual-private-work', repository:'/actual-source', inputs:{},
        stageCompiler() {return {manifest:'/actual-captured-driver/Cargo.toml'};},
        createPrivateDriverTarget() {return '/actual-private-work/driver-target';},
        run(...args) {observed.push(['unexpected-fallback', ...args]);},
      });
      const argv = ['verify', '/actual-private-subject/project/lexlean.toml'];
      invoke(argv);
      assert.deepEqual(JSON.parse(JSON.stringify(observed)), [['driver', argv, '/actual-source']]);
      const exporter = /const invokeExporter = args => shared \?[\s\S]*?;\n/.exec(text);
      assert(exporter, 'one unchanged model-path exporter boundary');
      const exported = [];
      const invokeExporter = runInNewContext(exporter[0] + '\ninvokeExporter;', {
        shared:{runExporter(...args) {exported.push(args);}}, join,
        lean:'/actual-private-subject/lean', exporter:{bin:'/must-not-adopt',dir:'/must-not-adopt'},
        run() {assert.fail('shared path adopted an independent or cached executable');},
      });
      const roots = ['--module','PrismPM.Fixture','--root','PrismPM.Fixture.root','--out','/actual-private-subject/export'];
      invokeExporter(roots);
      assert.deepEqual(JSON.parse(JSON.stringify(exported)), [[roots, '/actual-private-subject/lean/.lake/build/lib/lean']]);
      assert(text.includes("invokeDriver(['verify', join(project, 'lexlean.toml')])"));
      assert(text.includes("invokeDriver(['native', ir, generated, repository])"));
      assert(text.includes('invokeDriver([mode, ir, guest, repository])'));
      assert(text.includes("run('lake', ['build', 'PrismGenerated'], lean)"));
      assert(text.includes("'two independent generated Core-Wasm packages'"));
      assert(text.includes('if (shared) shared.verify(); else compiler.unchanged();'));
    };
    check(source);
    for (const [from, to] of [
      ["requireCompilerOwner(compilerOwner, '" + family + "')", "requireCompilerOwner(compilerOwner, 'absent-family')"],
      ['if (shared) invokeDriver =', 'if (false) invokeDriver ='],
      ['shared.runDriver(args, repository)', 'shared.runDriver(args, work)'],
      ["shared.runExporter(args, join(lean, '.lake/build/lib/lean'))", "shared.runExporter(args, '/prior-export')"],
      ["invokeDriver(['verify', join(project, 'lexlean.toml')])", "invokeDriver(['check', join(project, 'lexlean.toml')])"],
      ["invokeDriver(['native', ir, generated, repository])", "invokeDriver(['native', ir, generated, work])"],
      ['invokeDriver([mode, ir, guest, repository])', 'invokeDriver([mode, ir, generated, repository])'],
      ["run('lake', ['build', 'PrismGenerated'], lean)", 'undefined'],
      ["'two independent generated Core-Wasm packages'", "'REMOVED'"],
      ['if (shared) shared.verify(); else compiler.unchanged();', 'undefined;'],
    ]) {
      assert(source.includes(from), 'real mutation anchor: ' + family + ': ' + from);
      const changed = source.replaceAll(from, to); assert.notEqual(changed, source);
      assert.throws(() => check(changed), undefined, family + ': ' + from);
    }
  }
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

test('product preservation detects generated source proof package native Wasm and custody defects', t => {
  for (const family of ['effects', 'budget', 'operation-journal', 'presentation', 'publication']) {
    const work=fs.mkdtempSync(join(tmpdir(),'prismpm-product-preservation-'));
    t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
    const put=(relative,bytes='product-preservation unit fixture')=>{
      const path=join(work,relative);fs.mkdirSync(join(path,'..'),{recursive:true});
      fs.writeFileSync(path,bytes);return path;
    };
    const executable=family==='publication'?'publication-admission-runner':'browser-'+family+'-runner';
    const paths=['project/source.lex.tex','lean/modules/source','export/kernel.ir',
      'generated/Cargo.toml',
      ...['runner/src/main.rs','native-target/release/'+executable]];
    if(family==='operation-journal')paths.push('generated-b/Cargo.toml');
    const guests=family==='effects'?['a','b','echo']:['budget','publication'].includes(family)?['a','b']:
      family==='presentation'?['a','b','fixture','labels','intent','secret','route','sink',
        'maxroute','maxsink','maxfield','maxsecret','progress','maxprogress']:
        ['a','b','echo','journal','partition','journal-b','partition-b'];
    for(const guest of guests)paths.push('guest-'+guest+'/Cargo.toml',
      ('guest-'+guest+'/target')
        +'/wasm32-unknown-unknown/release/product.wasm');
    for(const path of paths)put(path);
    const native=join(work,'native-target'+'/release/'+executable);
    const linked=join(native,'../cargo-deps-link');
    fs.linkSync(native,linked);
    const linkedProducts=captureVerificationProducts(work,family);
    assert.equal(linkedProducts.files.find(row=>row.path===native.slice(work.length+1)).links,'2',
      'preserve genuine Cargo-style product link count, not single-link source policy');
    fs.appendFileSync(linked,'changed through link');
    assert.throws(()=>assert.deepEqual(captureVerificationProducts(work,family),linkedProducts));
    fs.writeFileSync(linked,'product-preservation unit fixture');
    const verify=(snapshot)=>assert.deepEqual(captureVerificationProducts(work,family),snapshot);
    for(const relative of paths) {
      const path=join(work,relative),before=captureVerificationProducts(work,family);
      const bytes=fs.readFileSync(path);
      fs.appendFileSync(path,'changed');
      assert.throws(()=>verify(before),undefined,'changed actual product: '+relative);
      fs.writeFileSync(path,bytes);
      const restored=captureVerificationProducts(work,family);
      fs.renameSync(path,path+'-saved');
      assert.throws(()=>verify(restored),undefined,'deleted actual product: '+relative);
      fs.renameSync(path+'-saved',path);
    }
    const path=join(work,paths[0]),before=captureVerificationProducts(work,family);
    fs.renameSync(path,path+'-saved');fs.copyFileSync(path+'-saved',path);
    assert.throws(()=>verify(before),undefined,'same-byte replacement is not original product custody');
    fs.unlinkSync(path);fs.renameSync(path+'-saved',path);
    const current=captureVerificationProducts(work,family),mode=fs.lstatSync(path).mode;
    fs.chmodSync(path,mode^0o040);
    assert.throws(()=>verify(current),undefined,'product mode change');
    fs.chmodSync(path,mode);
    const stable=captureVerificationProducts(work,family);
    put('generated/added');
    assert.throws(()=>verify(stable),undefined,'added package artifact');
    fs.unlinkSync(join(work,'generated/added'));
    for (const relative of ['generated/src/target', 'project/src/target', 'lean/modules/target', 'export/target']) {
      const prior = captureVerificationProducts(work,family);
      const payload = put(relative + '/payload');
      assert.throws(()=>verify(prior),undefined,'nested source/proof/package target cannot hide an artifact: '+relative);
      const captured = captureVerificationProducts(work,family);
      fs.appendFileSync(payload,'changed');
      assert.throws(()=>verify(captured),undefined,'nested target payload change: '+relative);
      fs.unlinkSync(payload);fs.rmdirSync(join(work,relative));
    }
    fs.renameSync(path,path+'-saved');fs.symlinkSync(path+'-saved',path);
    assert.throws(()=>captureVerificationProducts(work,family),/aliases|unaliased/);
    fs.unlinkSync(path);fs.renameSync(path+'-saved',path);
    const root=join(work,'lean'),rootMode=fs.lstatSync(root).mode;
    fs.chmodSync(root,rootMode|0o020);
    assert.throws(()=>captureVerificationProducts(work,family),/group\/other writable/);
    fs.chmodSync(root,rootMode);
    const guest=join(work,'guest-'+guests[0]);
    fs.renameSync(guest,guest+'-substituted');
    assert.throws(()=>captureVerificationProducts(work,family),/exact independent generated guest inventory/);
    fs.renameSync(guest+'-substituted',guest);
  }
});

test('compiler owner refuses malformed or incomplete input closures before building', () => {
  const families = ['view', 'custody', 'effects', 'presentation', 'operation-journal', 'budget', 'publication'];
  const source = fs.readFileSync(new URL('./compiler-owner.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('const families = Object.freeze({');
  const end = source.indexOf('\nconst owners = ', begin);
  assert(begin >= 0 && end > begin);
  const registered = runInNewContext(source.slice(begin, end) + '\nObject.keys(families);');
  assert.deepEqual([...registered].sort(), [...families].sort(), 'exact existing-family input closure');
  let called = false;
  const accessor = {get malicious() {called = true; return '0'.repeat(64);}};
  for (const family of families) for (const inputs of [null, [], accessor, {'../escape': '0'.repeat(64)},
    {'vendor/lexlean/MANIFEST.sha256': 'invalid'}, {'a': null}, {'a': 42}, {}])
    assert.throws(() => createCompilerOwner(family, inputs),
      /compiler input (map|path|digest|closure)/);
  assert.equal(called, false, 'input accessors cannot run before immutable capture');
  for (const name of families) {
    const inputs = captureCompilerInputs(name);
    for (const missing of ['tests/browser-view/compile.mjs', 'tests/browser-view/compiler-artifact.mjs',
      'tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/serial-compiler-owner.mjs',
      'tests/browser-view/verification-products.mjs', 'vendor/lean4-prod/lean.tar']) {
      const changed = {...inputs}; delete changed[missing];
      assert.throws(() => createCompilerOwner(name, changed), /complete closed compiler input closure/);
    }
    assert.throws(() => createCompilerOwner(name, {...inputs, unexpected: '0'.repeat(64)}), /complete closed compiler input closure/);
  }
});
