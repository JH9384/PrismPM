import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boundedConstructionRoot, buildSeed, constructionEnvironment, createConstructionStage, publishSeedFiles, readSmall, runConstruction, runtimePaths, separateConstructionTrees, snapshotFile, snapshotTree, validateConstructionFilesystem} from './exporter-seed.mjs';
import {decodeExporterSeed, encodeInventory, exporterArtifactBindings} from './inventory-metadata.mjs';
import {bindSeedInventory, bindSeedManifest, stageSeedFiles, verifySeedFiles} from './exporter-seed-admission.mjs';
import * as seedRuntime from './exporter-seed.mjs';
import {closeSync, openSync} from 'node:fs';

test('native ELF classification rejects malformed or foreign headers and never bypasses dynamic closure', async t => {
  const root=fixture(t),path=join(root,'program');
  const elf=(types=[1],machine=62)=>{
    const bytes=Buffer.alloc(64+56*types.length);Buffer.from([127,69,76,70,2,1,1]).copy(bytes);
    bytes.writeUInt16LE(2,16);bytes.writeUInt16LE(machine,18);bytes.writeUInt32LE(1,20);
    bytes.writeBigUInt64LE(64n,32);bytes.writeUInt16LE(64,52);bytes.writeUInt16LE(56,54);bytes.writeUInt16LE(types.length,56);
    for(const [index,type] of types.entries())bytes.writeUInt32LE(type,64+56*index);
    return bytes;
  };
  const classify=(bytes,arch='x64',implementation=seedRuntime.elfRuntimeMode)=>{writeFileSync(path,bytes);const fd=openSync(path,'r');
    try{return implementation(fd,bytes.length,arch);}finally{closeSync(fd);}};
  assert.equal(classify(elf()),'static');assert.equal(classify(elf([1],183),'arm64'),'static');
  for(const types of [[1,2],[1,3],[1,2,3]])assert.equal(classify(elf(types)),'dynamic');
  assert.equal(classify(Buffer.from('#!/bin/sh\nexit 0\n')),null);
  for(const mutation of [b=>b.subarray(0,63),b=>{b[4]=1;return b;},b=>{b[5]=2;return b;},
    b=>{b[6]=0;return b;},b=>{b.writeUInt16LE(1,16);return b;},b=>{b.writeUInt32LE(0,20);return b;},
    b=>{b.writeUInt16LE(63,52);return b;},b=>{b.writeUInt16LE(55,54);return b;},
    b=>{b.writeUInt16LE(0,56);return b;},b=>{b.writeUInt16LE(65535,56);return b;},
    b=>{b.writeBigUInt64LE(0xffffffffffffffffn,32);return b;},b=>{b.writeBigUInt64LE(0n,32);return b;},
    b=>{b.writeBigUInt64LE(999999n,72);return b;},b=>{b.writeBigUInt64LE(1n,96);return b;},
    b=>{b.writeUInt32LE(2,64);return b;},b=>{b.writeUInt32LE(5,64);return b;}])
    assert.throws(()=>classify(mutation(elf())));
  assert.throws(()=>classify(elf([1],183)));
  assert.throws(()=>classify(elf(),'unknown'));
  const unused=elf([1,0]);unused.fill(255,128);assert.equal(classify(unused),'static');
  const source=readFileSync(new URL('./exporter-seed.mjs',import.meta.url),'utf8');
  for(const [index,before,after,bytes,expectation] of [
    [0,'if (type === 2 || type === 3) dynamic = true;','',elf([1,2]),'dynamic'],
    [1,"assert.equal(header.readUInt16LE(18), machine, 'foreign ELF machine');",'',elf([1],183),'refuse'],
    [2,"assert(start + size <= BigInt(length), 'ELF segment outside file');",'',
      (()=>{const b=elf();b.writeBigUInt64LE(999999n,72);return b;})(),'refuse']]){
    assert.equal(source.split(before).length,2);const module=join(root,'mutant-'+index+'.mjs');
    writeFileSync(module,source.replace(before,after).replace("'./inventory-metadata.mjs'",JSON.stringify(new URL('./inventory-metadata.mjs',import.meta.url).href)));
    const mutant=await import(new URL('file://'+module).href);
    if(expectation==='refuse')assert.doesNotThrow(()=>classify(bytes,'x64',mutant.elfRuntimeMode));
    else assert.notEqual(classify(bytes,'x64',mutant.elfRuntimeMode),expectation);
  }
});

test('real compiler static and dynamic ELF closure agrees with GNU readelf and retains dynamic failures', t => {
  const root=fixture(t),source=join(root,'source.c');writeFileSync(source,'int main(void){return 0;}\n');
  const execute=(program,args)=>{const result=spawnSync(program,args,{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);return result;};
  for(const mode of ['static','dynamic']){
    const program=join(root,mode);execute('/usr/bin/cc',[...(mode==='static'?['-static']:[]),source,'-o',program]);
    const headers=execute('/usr/bin/readelf',['--program-headers','--wide',program]).stdout;
    assert.equal(/\b(?:INTERP|DYNAMIC)\b/.test(headers),mode==='dynamic');
    const closure=seedRuntime.runtimeClosure([program],join(root,'not-a-toolchain'),root,process.env);
    if(mode==='static')assert.deepEqual(closure,[]);
    else{assert(closure.length>=2);assert(closure.some(row=>row.selected.includes('libc.so')));
      assert.throws(()=>seedRuntime.runtimeClosure([program],join(root,'not-a-toolchain'),root,process.env,
        ()=>{throw new Error('actual dynamic dependency inspection failure');}),/dynamic dependency inspection failure/);}
    if(mode==='dynamic'){
      const bytes=readFileSync(program),name=Buffer.from('libc.so.6'),offset=bytes.indexOf(name);
      assert(offset>=0);assert.equal(bytes.indexOf(name,offset+name.length),-1);
      Buffer.from('nope.so.6').copy(bytes,offset);const broken=join(root,'missing-library');writeFileSync(broken,bytes,{mode:0o755});
      assert.match(execute('/usr/bin/ldd',[broken]).stdout,/nope\.so\.6 => not found/);
      assert.throws(()=>seedRuntime.runtimeClosure([broken],join(root,'not-a-toolchain'),root,process.env),/unresolved or unrecognized/);
    }
    const fd=openSync(program,'r');try{assert.equal(seedRuntime.elfRuntimeMode(fd,lstatSync(program).size),mode);}finally{closeSync(fd);}
  }
});

test('runtime executable custody rejects aliases and changes during real dependency inspection', t => {
  const root=fixture(t),program=join(root,'program'),source=join(root,'source.c');
  writeFileSync(source,'int main(void){return 0;}\n');
  const built=spawnSync('/usr/bin/cc',[source,'-o',program],{encoding:'utf8',timeout:10000});
  assert.ifError(built.error);assert.equal(built.signal,null);assert.equal(built.status,0,built.stderr);
  const linked=join(root,'linked');linkSync(program,linked);
  assert.throws(()=>seedRuntime.runtimeClosure([program],root,root,process.env),/bounded runtime executable/);
  rmSync(linked);symlinkSync(program,linked);
  assert.throws(()=>seedRuntime.runtimeClosure([linked],root,root,process.env),/alias refused/);
  assert.throws(()=>seedRuntime.runtimeClosure([program],root,root,process.env,()=>{
    writeFileSync(program,readFileSync(program));return{stdout:'\tstatically linked\n'};
  }),/compiler input changed/);
});

// Metadata-only fixture. Real construction and executable measurements are
// tested separately by exporter-seed.integration.mjs inside the pinned SDK.
function manifestFixture() {
  const directory = path => ({path, kind: 'directory', mode: 0o755});
  const file = path => ({path, kind: 'file', mode: 0o755, byte_length: 12, sha256: 'b'.repeat(64)});
  const toolchain = 'leanprover/lean4:v4.30.0';
  return {schema: 'prismpm/exporter-seed/1', compiler_revision: 'a'.repeat(40), platform: 'linux/amd64',
    archive_sha256: 'c'.repeat(64), toolchain,
    configuration: {argv: ['build', 'prod-export'], construction_root: '/tmp/prismpm-exporter-construction',
      temporary_directory: 'private-bounded-tmpfs', environment: {
        PATH: '/usr/local/elan/toolchains/leanprover--lean4---v4.30.0/bin:/usr/bin:/bin',
        LANG: 'C', LC_ALL: 'C', ELAN_HOME: '/usr/local/elan', ELAN_TOOLCHAIN: toolchain, LEAN_NUM_THREADS: '2', SOURCE_DATE_EPOCH: '0',
      }},
    source_files: [directory('Prod'), file('Prod/Export.lean')],
    toolchain_files: [directory('bin'), file('bin/lake'), file('bin/lean')],
    runtime_files: [{selected: '/lib/libc.so.6', path: '/usr/lib/libc.so.6', mode: 0o755,
      byte_length: 12, sha256: 'd'.repeat(64)}],
    files: [directory('.lake'), directory('.lake/build'), directory('.lake/build/bin'), file('.lake/build/bin/prod-export')],
  };
}

function fixture(t, parent = tmpdir()) {
  const root = mkdtempSync(join(parent, 'prismpm-seed-snapshot-'));
  t.after(() => rmSync(root, {recursive: true}));
  return root;
}

test('runtime parser distinguishes explicit static linkage from missing dependencies', () => {
  assert.deepEqual(runtimePaths('\tstatically linked\n'), []);
  assert.deepEqual(runtimePaths('\tlinux-vdso.so.1 (0x00001)\n\tlibc.so.6 => /lib/libc.so.6 (0x00002)\n\t/lib64/ld-linux.so.2 (0x00003)\n'),
    ['/lib/libc.so.6', '/lib64/ld-linux.so.2']);
  for (const text of ['', '\tlibc.so.6 => not found\n', '\tnot a dynamic executable\n', '\tstatically linked\nextra']) {
    assert.throws(() => runtimePaths(text));
  }
});

test('snapshot binds every file, directory, byte and mode without accepting a seed', t => {
  const root = fixture(t); mkdirSync(join(root, '.lake'));
  writeFileSync(join(root, '.lake', 'trace'), 'actual fixture bytes', {mode: 0o644});
  const first = snapshotTree(root);
  assert.deepEqual(first.map(row => [row.path, row.kind]), [['.lake', 'directory'], ['.lake/trace', 'file']]);
  writeFileSync(join(root, '.lake', 'trace'), 'other fixture bytes');
  assert.notDeepEqual(snapshotTree(root), first);
  const second = snapshotTree(root); chmodSync(join(root, '.lake', 'trace'), 0o600);
  assert.notDeepEqual(snapshotTree(root), second);
  writeFileSync(join(root, 'extra'), 'x'); assert.equal(snapshotTree(root).length, 3);
  chmodSync(join(root, 'extra'), 0o4755);
  assert.throws(() => snapshotTree(root), /special compiler file permissions/);
});

test('seed snapshots reject file/directory aliases and hard links', t => {
  const root = fixture(t), other = fixture(t);
  writeFileSync(join(other, 'source'), 'content');
  symlinkSync(join(other, 'source'), join(root, 'alias'));
  assert.throws(() => snapshotTree(root), /alias refused/);
  rmSync(join(root, 'alias')); symlinkSync(other, join(root, 'alias'));
  assert.throws(() => snapshotTree(root), /alias refused/);
  rmSync(join(root, 'alias')); linkSync(join(other, 'source'), join(root, 'linked'));
  assert.throws(() => snapshotTree(root), /singly-linked/);
});

test('toolchain aliases are explicit, relative, file-only, and confined', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'lib.so.1'), 'fixture');
  symlinkSync('lib.so.1', join(root, 'lib.so'));
  assert.equal(snapshotTree(root, {toolchainAliases: true}).find(row => row.path === 'lib.so').target, 'lib.so.1');
  symlinkSync('lib.so', join(root, 'lib-alias.so'));
  assert.equal(snapshotTree(root, {toolchainAliases: true}).find(row => row.path === 'lib-alias.so').target, 'lib.so');
  rmSync(join(root, 'lib-alias.so'));
  rmSync(join(root, 'lib.so')); symlinkSync('../outside', join(root, 'lib.so'));
  assert.throws(() => snapshotTree(root, {toolchainAliases: true}), /unconfined/);
  rmSync(join(root, 'lib.so')); mkdirSync(join(root, 'directory')); symlinkSync('directory', join(root, 'lib.so'));
  assert.throws(() => snapshotTree(root, {toolchainAliases: true}), /escapes closure/);
});

test('bounded snapshots reject oversized sparse files and aggregate/count excess', t => {
  const root = fixture(t), file = join(root, 'source');
  writeFileSync(file, 'x'); truncateSync(file, 8 * 1024 ** 3);
  assert.throws(() => snapshotFile(file), /bounded/);
  truncateSync(file, 8);
  assert.throws(() => snapshotTree(root, {bounds: {files: 1, file: 8, total: 7}}), /bounded/);
  writeFileSync(join(root, 'extra'), 'x');
  assert.throws(() => snapshotTree(root, {bounds: {files: 1, file: 8, total: 16}}), /count exceeded/);
});

test('directory enumeration is streamed and closes real iterators on every outcome', t => {
  for (const phase of ['success', 'count', 'alias']) {
    const root = fixture(t);
    for (let index = 0; index < 4; index++) writeFileSync(join(root, `entry-${index}`), 'x');
    if (phase === 'alias') symlinkSync('entry-0', join(root, 'alias'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const [root, phase, module] = process.argv.slice(1);
      const open = fs.opendirSync;
      let opened = 0, closed = 0, reads = 0;
      // Instrument real filesystem calls; no substitute tree or acceptance.
      fs.readdirSync = () => { throw new Error('unbounded directory materialization'); };
      fs.opendirSync = (...args) => {
        assert.equal(args[1]?.bufferSize, 1);
        const stream = open(...args); opened++;
        const read = stream.readSync.bind(stream), close = stream.closeSync.bind(stream);
        stream.readSync = () => { reads++; return read(); };
        stream.closeSync = () => { closed++; return close(); };
        return stream;
      };
      syncBuiltinESMExports();
      const {snapshotTree} = await import(module);
      const capture = () => snapshotTree(root, {bounds: {files: phase === 'count' ? 1 : 8, file: 8, total: 64}});
      if (phase === 'success') assert.equal(capture().length, 4);
      else assert.throws(capture, phase === 'count' ? /entry count exceeded/ : /alias refused/);
      assert.equal(opened, 1); assert.equal(closed, opened);
      if (phase === 'count') assert.equal(reads, 2, 'stop at the first excess entry');
    `, root, phase, new URL('./exporter-seed.mjs', import.meta.url).href],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error); assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('deep and maximum-width snapshots preserve exact bytewise canonical ordering', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'a')); writeFileSync(join(root, 'a', 'child'), 'child');
  writeFileSync(join(root, 'a-'), 'sibling');
  assert.deepEqual(snapshotTree(root).map(row => row.path), ['a', 'a-', 'a/child']);
  let deep = root;
  for (let depth = 0; depth < 80; depth++) { deep = join(deep, 'd'); mkdirSync(deep); }
  writeFileSync(join(deep, 'member'), 'deep');
  assert(snapshotTree(root).some(row => row.path === 'd/'.repeat(80) + 'member'));
  const wide = fixture(t);
  for (let index = 0; index < 32768; index++) writeFileSync(join(wide, `entry-${index}`), '');
  assert.equal(snapshotTree(wide).length, 32768);
  writeFileSync(join(wide, 'overflow'), '');
  assert.throws(() => snapshotTree(wide), /entry count exceeded/);
});

test('constructed source and full seed inventories keep independent entry and byte allowances', t => {
  const root = fixture(t), source = join(root, 'package'), seed = join(root, 'seed');
  mkdirSync(source);
  const member = join(source, 'source'); writeFileSync(member, ''); truncateSync(member, 16 * 1024 ** 2);
  for (let index = 1; index < 4096; index++) writeFileSync(join(source, `source-${index}`), '');
  const sources = snapshotTree(source);
  assert.equal(sources.length, 4096);
  mkdirSync(join(source, '.lake'));
  for (const name of ['first', 'second']) {
    const path = join(source, '.lake', name); writeFileSync(path, ''); truncateSync(path, 256 * 1024 ** 2);
  }
  // .lake + two full-size files + 4093 empty entries exactly meet both bounds.
  for (let index = 3; index < 4096; index++) writeFileSync(join(source, '.lake', `entry-${index}`), '');
  const files = separateConstructionTrees(source, seed, sources);
  assert.equal(files.length, 4096);
  assert.equal(files.reduce((sum, row) => sum + (row.byte_length ?? 0), 0), 512 * 1024 ** 2);
  assert.deepEqual(snapshotTree(source), sources);
  for (const defect of ['extra', 'source-oversize', 'seed-overflow']) {
    const owner = fixture(t), input = join(owner, 'package'); mkdirSync(input);
    writeFileSync(join(input, 'source'), 'source'); const expected = snapshotTree(input);
    mkdirSync(join(input, '.lake'));
    if (defect === 'extra') writeFileSync(join(input, 'extra'), 'unexpected');
    if (defect === 'source-oversize') truncateSync(join(input, 'source'), 16 * 1024 ** 2 + 1);
    if (defect === 'seed-overflow') {
      const path = join(input, '.lake', 'oversize'); writeFileSync(path, ''); truncateSync(path, 256 * 1024 ** 2 + 1);
    }
    assert.throws(() => separateConstructionTrees(input, join(owner, 'seed'), expected));
  }
});

test('construction retains original source identities through same-byte source substitution', t => {
  const owner=fixture(t),input=join(owner,'package'),seed=join(owner,'seed');mkdirSync(input);
  writeFileSync(join(input,'source'),'actual source identity');
  const program=`
    import assert from 'node:assert/strict';
    import {renameSync,writeFileSync,mkdirSync} from 'node:fs';
    const {snapshotTree,separateConstructionTrees}=await import(process.argv[1]);
    const [input,seed,owner]=process.argv.slice(2),custody=new Map();
    const expected=snapshotTree(input,{custody});
    renameSync(input+'/source',owner+'/original-source');
    writeFileSync(input+'/source','actual source identity');mkdirSync(input+'/.lake');
    assert.throws(()=>separateConstructionTrees(input,seed,expected,new Map(),custody),/compiler input changed/);
  `;
  const run=spawnSync(process.execPath,['--input-type=module','-e',program,new URL('./exporter-seed.mjs',import.meta.url).href,input,seed,owner],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(readFileSync(join(owner,'original-source'),'utf8'),'actual source identity');
});

test('real construction extraction and separation cannot redirect into substituted directories', t => {
  for(const phase of ['extraction','separation']) {
    const owner=fixture(t),staging=join(owner,'staging'),foreign=join(owner,'foreign');
    mkdirSync(staging,{mode:0o700});mkdirSync(foreign);writeFileSync(join(foreign,'marker'),'foreign must survive');
    const originalSource=join(owner,'archive-input');mkdirSync(originalSource);writeFileSync(join(originalSource,'source'),'actual archive input');
    const archive=join(owner,'source.tar');
    const archived=spawnSync('/usr/bin/tar',['-cf',archive,'-C',originalSource,'source'],{encoding:'utf8'});
    assert.equal(archived.status,0,archived.stderr);
    const program=`
      import assert from 'node:assert/strict';import * as fs from 'node:fs';
      import * as cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
      const [module,phase,staging,foreign,archive]=process.argv.slice(1);
      const helpers=await import(module),stage=helpers.holdDirectory(staging);
      const pkg=helpers.createHeldChild(stage,'package'),cwd=pkg.path;
      const held={directory:pkg,temporary:stage};
      const rename=fs.default.renameSync,spawn=cp.default.spawnSync;
      try {
        if(phase==='extraction') {
          cp.default.spawnSync=(...args)=>{
            rename(cwd,staging+'/displaced-package');fs.mkdirSync(cwd,{mode:0o700});
            fs.writeFileSync(cwd+'/foreign-marker','must survive');
            return spawn(...args);
          };syncBuiltinESMExports();
          assert.throws(()=>helpers.runConstruction('/usr/bin/tar',['--extract','--file',archive,'--directory','/proc/self/fd/3'],cwd,{PATH:'/usr/bin:/bin'},held),/directory identity changed/);
          assert.equal(fs.readFileSync(staging+'/displaced-package/source','utf8'),'actual archive input');
          assert.deepEqual(fs.readdirSync(cwd),['foreign-marker']);
        } else {
          helpers.runConstruction('/usr/bin/tar',['--extract','--file',archive,'--directory','/proc/self/fd/3'],cwd,{PATH:'/usr/bin:/bin'},held);
          const custody=new Map(),sources=helpers.snapshotTree(cwd,{custody});
          fs.mkdirSync(cwd+'/.lake');fs.writeFileSync(cwd+'/.lake/member','actual constructed member');
          fs.default.renameSync=(from,to)=>{
            if(String(from).startsWith('/proc/self/fd/')) {
              rename(staging+'/seed',staging+'/displaced-seed');fs.symlinkSync(foreign,staging+'/seed');
            }
            return rename(from,to);
          };syncBuiltinESMExports();
          assert.throws(()=>helpers.separateConstructionTrees(cwd,staging+'/seed',sources,new Map(),custody,pkg,stage),/directory identity changed/);
          assert.equal(fs.readFileSync(staging+'/displaced-seed/.lake/member','utf8'),'actual constructed member');
        }
        assert.deepEqual(fs.readdirSync(foreign),['marker']);
      } finally {fs.closeSync(pkg.fd);fs.closeSync(stage.fd);}
    `;
    const run=spawnSync(process.execPath,['--input-type=module','-e',program,new URL('./exporter-seed.mjs',import.meta.url).href,phase,staging,foreign,archive],{encoding:'utf8'});
    assert.equal(run.status,0,`${phase}: ${run.stderr}`);
    assert.equal(readFileSync(join(foreign,'marker'),'utf8'),'foreign must survive');
  }
});

test('deferred and previously visited directory substitution fails custody', t => {
  for (const phase of ['pending', 'visited']) {
    const root = fixture(t); mkdirSync(join(root, 'first')); mkdirSync(join(root, 'second'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      import {join} from 'node:path';
      const [root, phase, module] = process.argv.slice(1);
      const open = fs.opendirSync; let first, mutated = false, live = 0;
      fs.opendirSync = (...args) => {
        const stream = open(...args); live++;
        const close = stream.closeSync.bind(stream);
        stream.closeSync = () => {
          close(); live--;
          if (phase === 'pending' && args[0] === root) {
            // Change only the child, not its parent directory membership.
            fs.chmodSync(join(root, 'first'), 0o700); mutated = true;
          } else if (phase === 'visited' && args[0] !== root) {
            if (!first) first = args[0];
            else { fs.chmodSync(first, 0o700); mutated = true; }
          }
        };
        return stream;
      };
      syncBuiltinESMExports(); const {snapshotTree} = await import(module);
      assert.throws(() => snapshotTree(root), /compiler input changed/);
      assert(mutated); assert.equal(live, 0);
    `, root, phase, new URL('./exporter-seed.mjs', import.meta.url).href],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error); assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('configuration reads are bounded, regular, singly linked, and strict UTF-8', t => {
  const root = fixture(t), path = join(root, 'configuration');
  writeFileSync(path, 'valid'); assert.equal(readSmall(path, 256), 'valid');
  truncateSync(path, 8 * 1024 ** 3);
  assert.throws(() => readSmall(path, 256), /bounded/);
  truncateSync(path, 0); writeFileSync(path, Buffer.from([0xff]));
  assert.throws(() => readSmall(path, 256));
  symlinkSync(path, join(root, 'alias'));
  assert.throws(() => readSmall(join(root, 'alias'), 256), /aliased/);
  linkSync(path, join(root, 'linked'));
  assert.throws(() => readSmall(path, 256), /singly-linked/);
});

test('configuration reads reject same-byte replacement and rewriting during the actual read', t => {
  const root = fixture(t);
  for (const mutation of ['replace', 'rewrite']) {
    const path = join(root, mutation);
    writeFileSync(path, 'unchanged configuration');
    // Isolate scheduling hooks in a child. All reads and mutations use real
    // descriptors/files; only the instant of the adversarial write is selected.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const path = process.argv[1], mutation = process.argv[2];
      const original = fs.readSync;
      let mutated = false;
      fs.readSync = (...args) => {
        const count = original(...args);
        if (!mutated && args[1].length === 257 && count > 0) {
          mutated = true;
          if (mutation === 'replace') {
            fs.writeFileSync(path + '.replacement', 'unchanged configuration');
            fs.renameSync(path + '.replacement', path);
          } else fs.writeFileSync(path, 'unchanged configuration');
        }
        return count;
      };
      syncBuiltinESMExports();
      const {readSmall} = await import(process.argv[3]);
      assert.throws(() => readSmall(path, 256), /compiler input changed/);
      assert(mutated, 'the real filesystem mutation must execute');
    `, path, mutation, new URL('./exporter-seed.mjs', import.meta.url).href],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, `${mutation}: ${result.stderr}`);
  }
});

test('construction requires a bounded memory filesystem and refuses existing output', t => {
  const root = fixture(t, '/dev/shm');
  assert.equal(boundedConstructionRoot(root), root);
  assert.throws(() => boundedConstructionRoot('/'), /bounded tmpfs/);
  const output = join(root, 'existing'); mkdirSync(output);
  assert.throws(() => buildSeed(root, output), /overwrite/);
  for (const [blocks, bsize] of [[0n, 4096n], [4096n, 0n], [1048576n, 4096n]]) {
    assert.throws(() => validateConstructionFilesystem({type: 0x01021994n, blocks, bsize}), /positive capacity/);
  }
});

test('real construction children use the owned bounded temporary directory', t => {
  const root = fixture(t, '/dev/shm');
  const environment = constructionEnvironment({PATH: '/usr/bin:/bin'}, root);
  const result = runConstruction('/usr/bin/printenv', ['TMPDIR'], root, environment);
  assert.equal(result.stdout, root + '\n');
  assert.equal(result.environment.TMPDIR, root);
  assert.equal(result.exit_code, 0);
  assert.throws(() => constructionEnvironment({}, '/'), /bounded tmpfs/);
});

test('fixed construction path refuses existing state without adopting or deleting it', t => {
  const root = fixture(t, '/dev/shm');
  const stage = createConstructionStage(root);
  writeFileSync(join(stage.path, 'sentinel'), 'retain');
  assert.throws(() => createConstructionStage(root), /EEXIST/);
  assert.equal(readFileSync(join(stage.path, 'sentinel'), 'utf8'), 'retain');
  const other = fixture(t, '/dev/shm');
  symlinkSync(stage.path, join(other, 'prismpm-exporter-construction'));
  assert.throws(() => createConstructionStage(other), /EEXIST/);
  assert.equal(readFileSync(join(stage.path, 'sentinel'), 'utf8'), 'retain');
});

test('construction initially holds its creation identity instead of adopting a replacement', t => {
  const owner=fixture(t,'/dev/shm');
  const program=`
    import assert from 'node:assert/strict';
    import {readFileSync,renameSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs';
    const module=process.argv[1],owner=process.argv[2];
    const {createConstructionStage,holdDirectory,createHeldChild}=await import(module);
    const original=createConstructionStage(owner);
    renameSync(original.path,owner+'/original');mkdirSync(original.path,{mode:0o700});
    writeFileSync(original.path+'/foreign-marker','must survive');
    assert.throws(()=>{
      const held=holdDirectory(original.path,original.identity);
      createHeldChild(held,'package');
    },/directory identity changed/);
    assert.deepEqual(readdirSync(original.path),['foreign-marker']);
    assert.deepEqual(readdirSync(owner+'/original'),[]);
    assert(readFileSync(new URL(module),'utf8').includes('holdDirectory(staging, owned)'));
  `;
  const run=spawnSync(process.execPath,['--input-type=module','-e',program,new URL('./exporter-seed.mjs',import.meta.url).href,owner],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
});

test('inventory distinguishes actual exporter identity from its native seed manifest', () => {
  // Explicit metadata fixture, not an SDK image or executable acceptance.
  const revision = 'a'.repeat(40), digest = 'b'.repeat(64);
  const value = manifestFixture();
  const capture = item => Buffer.from(encodeInventory(item));
  const measured = {byte_length: 12, mode: 0o755, sha256: digest};
  const rows = exporterArtifactBindings(capture(value), revision, 'linux/amd64', measured);
  assert.deepEqual(rows[0], {id: 'lean4-prod-exporter', kind: 'binary', version: revision, digest: `sha256:${digest}`});
  assert.equal(rows[1].id, 'lean4-prod-exporter-seed'); assert.equal(rows[1].kind, 'dependency-lock');
  assert.notEqual(rows[1].digest, rows[0].digest);
  for (const mutate of [
    item => { item.platform = 'linux/arm64'; }, item => { item.compiler_revision = 'c'.repeat(40); },
    item => { item.files = []; }, item => { item.files.push({...item.files[0]}); },
    item => { item.files.at(-1).mode = 0o644; }, item => { item.files.at(-1).kind = 'symlink'; },
    item => { item.files.at(-1).byte_length = 0; }, item => { item.files.at(-1).sha256 = 'invalid'; },
  ]) {
    const altered = structuredClone(value); mutate(altered);
    assert.throws(() => exporterArtifactBindings(capture(altered), revision, 'linux/amd64', measured));
  }
  assert.throws(() => exporterArtifactBindings(Buffer.from(JSON.stringify(value)), revision, 'linux/amd64', measured));
  for (const change of [{mode: 0o644}, {byte_length: 11}, {sha256: 'c'.repeat(64)}]) {
    assert.throws(() => exporterArtifactBindings(capture(value), revision, 'linux/amd64', {...measured, ...change}));
  }
});

test('seed wire reader closes every field, path, configuration and resource bound', () => {
  const decode = value => decodeExporterSeed(Buffer.from(encodeInventory(value)));
  const value = manifestFixture(); assert.deepEqual(decode(value), value);
  const changes = [
    item => { item.extra = true; }, item => { delete item.archive_sha256; },
    item => { item.configuration.environment.EXTRA = 'untrusted'; },
    item => { delete item.configuration.environment.LEAN_NUM_THREADS; },
    item => { item.configuration.environment.LEAN_NUM_THREADS = '9999'; },
    item => { item.configuration.construction_root = '/caller/cache'; },
    item => { item.configuration.argv.push('--no-build'); },
    item => { item.archive_sha256 = 'A'.repeat(64); },
    item => { item.platform = 'linux/386'; }, item => { item.toolchain = '../toolchain'; },
    item => { item.source_files[0].extra = true; },
    item => { item.source_files[1].path = 'Prod/../Export.lean'; },
    item => { item.source_files[1].path = '/Prod/Export.lean'; },
    item => { item.source_files.shift(); },
    item => { item.source_files[1].byte_length = 16 * 1024 ** 2 + 1; },
    item => { item.files.reverse(); }, item => { item.files.push({...item.files.at(-1)}); },
    item => { item.files.at(-1).mode = 0o4755; },
    item => { item.files.at(-1).sha256 = null; },
    item => { item.files.at(-1).byte_length = 256 * 1024 ** 2 + 1; },
    item => { item.files.at(-1).byte_length = -1; },
    item => { item.files.at(-1).byte_length = 0.5; },
    item => { item.files.push({path: 'outside', kind: 'directory', mode: 0o755}); },
    item => { item.toolchain_files[1] = {path: 'bin/lake', kind: 'symlink', mode: 0o777, target: 'absent'}; },
    item => { item.toolchain_files[1].extra = false; },
    item => { item.toolchain_files[1].mode = 0o644; },
    item => { item.toolchain_files[2].byte_length = 0; },
    item => { item.runtime_files = []; },
    item => { item.runtime_files[0].extra = true; },
    item => { item.runtime_files[0].selected = 'lib/libc.so.6'; },
    item => { item.runtime_files[0].path = '/usr/../lib/libc.so.6'; },
    item => { item.runtime_files.push({...item.runtime_files[0]}); },
  ];
  for (const [index, change] of changes.entries()) {
    const altered = structuredClone(value); change(altered);
    assert.throws(() => decode(altered), `mutation ${index} must fail closed`);
  }
  const alias = structuredClone(value);
  alias.toolchain_files.push({path: 'lean-alias', kind: 'symlink', mode: 0o777, target: 'bin/lean'});
  assert.deepEqual(decode(alias), alias);
  alias.toolchain_files.push({path: 'lean-indirect', kind: 'symlink', mode: 0o777, target: 'lean-alias'});
  assert.deepEqual(decode(alias), alias);
  alias.toolchain_files.at(-2).target = 'lean-indirect'; assert.throws(() => decode(alias), /cyclic/);
  alias.toolchain_files.at(-2).target = 'bin/lean';
  alias.toolchain_files.at(-1).target = '../bin/lean'; assert.throws(() => decode(alias));
  const runtime = structuredClone(value);
  runtime.runtime_files.push({...runtime.runtime_files[0], selected: '/usr/lib/libc.so.6'});
  assert.deepEqual(decode(runtime), runtime);
  for (const change of [{sha256: 'f'.repeat(64)}, {mode: 0o644}, {byte_length: 13}]) {
    const altered = structuredClone(runtime); Object.assign(altered.runtime_files[1], change);
    assert.throws(() => decode(altered), /runtime aliases disagree/);
  }
  const duplicate = encodeInventory(value).replace('"schema":', '"schema":"discarded","schema":');
  assert.throws(() => decodeExporterSeed(Buffer.from(duplicate)), /canonical/);
  assert.throws(() => decodeExporterSeed(Buffer.from([0xff])));
  assert.throws(() => decodeExporterSeed(Buffer.alloc(8 * 1024 ** 2 + 1)), /bounded/);
});

test('seed admission requires an independent inventory binding, including coherent rehash attacks', () => {
  const encode = value => Buffer.from(encodeInventory(value));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = manifestFixture(), bytes = encode(manifest);
  const inventory = {schema: 'prismpm/sdk-inventory/1', artifacts: [
    {id: 'lean4-prod-exporter', kind: 'binary', version: manifest.compiler_revision, digest: 'sha256:' + 'b'.repeat(64)},
    {id: 'lean4-prod-exporter-seed', kind: 'dependency-lock', version: '1', digest: 'sha256:' + hash(bytes)},
  ]};
  const locked = hash(encode(inventory));
  const authority = bindSeedInventory(encode(inventory), locked, manifest.compiler_revision);
  const identity = Object.fromEntries(['compiler_revision', 'archive_sha256', 'toolchain', 'platform'].map(key => [key, manifest[key]]));
  assert.deepEqual(bindSeedManifest(bytes, authority, identity), manifest);
  const tampered = structuredClone(manifest); tampered.files.at(-1).sha256 = 'e'.repeat(64);
  assert.throws(() => bindSeedManifest(encode(tampered), authority, identity), /independent SDK inventory/);
  const coherent = structuredClone(inventory);
  coherent.artifacts[0].digest = 'sha256:' + 'e'.repeat(64);
  coherent.artifacts[1].digest = 'sha256:' + hash(encode(tampered));
  assert.throws(() => bindSeedInventory(encode(coherent), locked, manifest.compiler_revision), /independent lock/);
  for (const key of Object.keys(identity)) {
    assert.throws(() => bindSeedManifest(bytes, authority, {...identity, [key]: 'changed'}));
  }
  for (const mutate of [
    item => { item.artifacts.pop(); }, item => { item.artifacts.push({...item.artifacts[0]}); },
    item => { item.artifacts[0].version = 'f'.repeat(40); },
    item => { item.artifacts[1].kind = 'binary'; },
    item => { item.artifacts[1].extra = true; },
  ]) {
    const changed = structuredClone(inventory); mutate(changed);
    assert.throws(() => bindSeedInventory(encode(changed), hash(encode(changed)), manifest.compiler_revision));
  }
  const legacy = encode({schema: 'prismpm/sdk-inventory/1', artifacts: []});
  assert.equal(bindSeedInventory(legacy, hash(legacy), manifest.compiler_revision), null);
});

test('actual seed/source snapshots refuse altered, missing, extra and aliased content', t => {
  const source = fixture(t), seed = fixture(t);
  mkdirSync(join(source, 'Prod')); writeFileSync(join(source, 'Prod/Export.lean'), 'source snapshot fixture');
  mkdirSync(join(seed, '.lake')); writeFileSync(join(seed, '.lake/trace'), 'actual fixture trace');
  const manifest = {source_files: snapshotTree(source), files: snapshotTree(seed)};
  writeFileSync(join(seed, 'manifest.json'), 'metadata is authenticated separately');
  verifySeedFiles(seed, source, manifest);
  const trace = join(seed, '.lake/trace');
  writeFileSync(trace, 'altered trace'); assert.throws(() => verifySeedFiles(seed, source, manifest), /seed closure differs/);
  rmSync(trace); assert.throws(() => verifySeedFiles(seed, source, manifest), /seed closure differs/);
  writeFileSync(trace, 'actual fixture trace');
  writeFileSync(join(seed, 'extra'), 'extra'); assert.throws(() => verifySeedFiles(seed, source, manifest), /seed closure differs/);
  rmSync(join(seed, 'extra')); rmSync(trace); symlinkSync(join(source, 'Prod/Export.lean'), trace);
  assert.throws(() => verifySeedFiles(seed, source, manifest), /alias/);
  rmSync(trace); writeFileSync(trace, 'actual fixture trace');
  writeFileSync(join(source, 'Prod/Export.lean'), 'changed source');
  assert.throws(() => verifySeedFiles(seed, source, manifest), /sources differ/);
});

test('seed staging exclusively copies bounded declared bytes and refuses changed inputs', t => {
  const seed = fixture(t), destination = fixture(t);
  mkdirSync(join(seed, '.lake/build/bin'), {recursive: true});
  const executable = join(seed, '.lake/build/bin/prod-export');
  writeFileSync(executable, 'metadata test bytes, not an executable acceptance', {mode: 0o755});
  const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
  stageSeedFiles(seed, destination, manifest);
  assert.deepEqual(snapshotTree(destination), manifest.files);
  assert.throws(() => stageSeedFiles(seed, destination, manifest), /empty staging/);
  assert.equal(readFileSync(join(destination, '.lake/build/bin/prod-export'), 'utf8'),
    'metadata test bytes, not an executable acceptance');
  const oversized = fixture(t); truncateSync(executable, 8 * 1024 ** 3);
  assert.throws(() => stageSeedFiles(seed, oversized, manifest), /bounded/);
  assert.equal(snapshotTree(oversized).some(row => row.kind === 'file'), false);
  const aliased = fixture(t); rmSync(executable); symlinkSync(join(destination, '.lake/build/bin/prod-export'), executable);
  assert.throws(() => stageSeedFiles(seed, aliased, manifest), /aliased/);
  const unsafe = structuredClone(manifest); unsafe.files.at(-1).path = '../escape';
  assert.throws(() => stageSeedFiles(seed, fixture(t), unsafe), /canonical relative/);
  const publicStage = fixture(t); chmodSync(publicStage, 0o755);
  assert.throws(() => stageSeedFiles(seed, publicStage, manifest), /private/);
});

test('seed staging rejects same-byte input replacement before and during copying', t => {
  for (const phase of ['open', 'read']) {
    const seed = fixture(t), destination = fixture(t);
    mkdirSync(join(seed, '.lake/build/bin'), {recursive: true});
    const executable = join(seed, '.lake/build/bin/prod-export');
    writeFileSync(executable, 'copy custody fixture', {mode: 0o755});
    const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const [seed, destination, path, phase, encoded, module] = process.argv.slice(1);
      const open = fs.openSync, read = fs.readSync;
      let opens = 0, input, mutated = false;
      function replace() {
        fs.writeFileSync(path + '.replacement', 'copy custody fixture', {mode: 0o755});
        fs.renameSync(path + '.replacement', path); mutated = true;
      }
      fs.openSync = (...args) => {
        if (fs.existsSync(args[0]) && fs.realpathSync(args[0]) === path && ++opens === 2) {
          if (phase === 'open') replace();
          input = open(...args); return input;
        }
        return open(...args);
      };
      fs.readSync = (...args) => {
        const count = read(...args);
        if (phase === 'read' && !mutated && args[0] === input && count > 0) replace();
        return count;
      };
      syncBuiltinESMExports();
      const {stageSeedFiles} = await import(module);
      assert.throws(() => stageSeedFiles(seed, destination, JSON.parse(encoded)), /seed input identity changed/);
      assert(mutated, 'the real filesystem replacement must execute');
    `, seed, destination, executable, phase, JSON.stringify(manifest),
    new URL('./exporter-seed-admission.mjs', import.meta.url).href],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, `${phase}: ${result.stderr}`);
  }
});

test('descriptor copying never writes into replaced staging roots or ancestors', t => {
  for (const phase of ['handoff-root', 'root-capture', 'root', 'ancestor-open', 'ancestor-file', 'ancestor-alias']) {
    const owner = fixture(t), seed = join(owner, 'source'), stage = join(owner, 'stage'), foreign = join(owner, 'foreign');
    mkdirSync(join(seed, '.lake/build/bin'), {recursive:true}); mkdirSync(stage,{mode:0o700}); mkdirSync(foreign);
    writeFileSync(join(seed, '.lake/build/bin/prod-export'), 'actual confined copy bytes', {mode:0o755});
    const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'; import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
      const [seed,stage,foreign,phase,encoded,module] = process.argv.slice(1);
      const open = fs.openSync; let replaced = false, displaced;
      const stagingAuthority = fs.lstatSync(stage,{bigint:true});
      const bin = join(stage,'.lake/build/bin');
      const marker = 'foreign content must remain untouched';
      fs.openSync = (...args) => {
        const [path,flags] = args;
        const descriptor = typeof path === 'string' && path.startsWith('/proc/self/fd/');
        const atFile = descriptor && (flags & fs.constants.O_WRONLY) !== 0;
        const atDirectory = phase === 'ancestor-open' && descriptor
          && (flags & fs.constants.O_DIRECTORY) !== 0 && fs.realpathSync(path) === bin;
        const atRootCapture = phase === 'root-capture' && path === stage
          && (flags & fs.constants.O_DIRECTORY) !== 0;
        if (!replaced && (atFile && !['ancestor-open','root-capture','handoff-root'].includes(phase) || atDirectory || atRootCapture)) {
          replaced = true;
          const target = ['root','root-capture'].includes(phase) ? stage : bin;
          displaced = target + '.owned'; fs.renameSync(target,displaced);
          if (phase === 'ancestor-alias') {
            fs.writeFileSync(join(foreign,'prod-export'),marker); fs.symlinkSync(foreign,target);
          } else {
            fs.mkdirSync(target,{mode:0o700});
            if (phase === 'root-capture') fs.writeFileSync(join(target,'foreign-marker'),marker);
            else {
              const replacementBin = phase === 'root' ? join(target,'.lake/build/bin') : target;
              fs.mkdirSync(replacementBin,{recursive:true}); fs.writeFileSync(join(replacementBin,'prod-export'),marker);
            }
          }
        }
        return open(...args);
      };
      if (phase === 'handoff-root') {
        displaced = stage + '.owned'; fs.renameSync(stage,displaced);fs.mkdirSync(stage,{mode:0o700});replaced=true;
      }
      syncBuiltinESMExports(); const {stageSeedFiles} = await import(module);
      assert.throws(() => stageSeedFiles(seed,stage,JSON.parse(encoded), {rootIdentity:stagingAuthority}), /identity changed/);
      assert(replaced);
      if (phase === 'handoff-root') assert.deepEqual(fs.readdirSync(stage),[], 'caller-original custody refuses before writing into a substituted empty stage');
      else assert.equal(fs.readFileSync(phase === 'root-capture' ? join(stage,'foreign-marker') : join(stage,'.lake/build/bin/prod-export'),'utf8'),marker);
      if (phase === 'root-capture') assert(!fs.existsSync(join(stage,'.lake')), 'initial root substitution must refuse before creating any foreign descendants');
      const copied = ['root','root-capture','handoff-root'].includes(phase) ? join(displaced,'.lake/build/bin/prod-export') : join(displaced,'prod-export');
      if (['ancestor-open','root-capture','handoff-root'].includes(phase)) assert(!fs.existsSync(copied), 'refuse before any foreign-parent write');
      else assert.equal(fs.readFileSync(copied,'utf8'),'actual confined copy bytes', 'held FD confines the real write to the original');
    `, seed, stage, foreign, phase, JSON.stringify(manifest), new URL('./exporter-seed.mjs',import.meta.url).href],
    {encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.ifError(result.error); assert.equal(result.signal,null); assert.equal(result.status,0,result.stdout+result.stderr);
    assert.deepEqual(snapshotTree(seed),manifest.files);
  }
});

test('publication cleanup never recursively adopts a newly inserted foreign descendant', t => {
  const owner = fixture(t), seed = join(owner,'source'), destination = join(owner,'published');
  mkdirSync(join(seed,'.lake/build/bin'),{recursive:true});
  writeFileSync(join(seed,'.lake/build/bin/prod-export'),'real publication fixture',{mode:0o755});
  const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
  const result = spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
    const [seed,destination,encoded,module] = process.argv.slice(1);
    const rm = fs.rmSync, rmdir = fs.rmdirSync; let planted;
    const insert = path => {
      if (planted || typeof path !== 'string') return;
      const actual = fs.realpathSync(path);
      if (!actual.split('/').at(-1).startsWith('.exporter-publication-')) return;
      planted = join(actual,'unknown','foreign-marker'); fs.mkdirSync(join(actual,'unknown'));
      fs.writeFileSync(planted,'must survive the actual cleanup primitive');
    };
    fs.rmSync = (...args) => { insert(args[0]); return rm(...args); };
    fs.rmdirSync = (...args) => { insert(args[0]); return rmdir(...args); };
    syncBuiltinESMExports(); const {publishSeedFiles} = await import(module);
    assert.throws(() => publishSeedFiles(seed,destination,JSON.parse(encoded)), /ENOTEMPTY/);
    assert(planted, 'insert after the final identity check before actual removal');
    assert.equal(fs.readFileSync(planted,'utf8'),'must survive the actual cleanup primitive');
    assert.equal(fs.readFileSync(join(destination,'.lake/build/bin/prod-export'),'utf8'),'real publication fixture');
  `,seed,destination,JSON.stringify(manifest),new URL('./exporter-seed.mjs',import.meta.url).href],
  {encoding:'utf8',timeout:15000,maxBuffer:65536});
  assert.ifError(result.error); assert.equal(result.signal,null); assert.equal(result.status,0,result.stderr);
});

test('construction retirement checks original nodes and preserves substituted or unknown descendants', t => {
  for (const phase of ['success','insert','replace']) {
    const root=fixture(t), staging=join(root,'stage'); mkdirSync(join(staging,'package'),{recursive:true});
    writeFileSync(join(staging,'package','source'),'original generated source');
    const result=spawnSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict'; import fs from 'node:fs'; import {join} from 'node:path';
      const [staging,phase,module]=process.argv.slice(1);
      const {snapshotTree,holdDirectory,retireOwnedDirectory}=await import(module);
      const held=holdDirectory(staging), nodes=new Map(); snapshotTree(staging,{custody:nodes});
      let marker;
      if(phase==='insert') { marker=join(staging,'unknown-marker');fs.writeFileSync(marker,'foreign content'); }
      if(phase==='replace') {
        fs.renameSync(join(staging,'package'),join(staging,'original-package'));
        fs.mkdirSync(join(staging,'package'));marker=join(staging,'package','source');fs.writeFileSync(marker,'foreign content');
      }
      try {
        if(phase==='success') { retireOwnedDirectory(held,nodes);assert(!fs.existsSync(staging)); }
        else { assert.throws(()=>retireOwnedDirectory(held,nodes));assert.equal(fs.readFileSync(marker,'utf8'),'foreign content'); }
      } finally {fs.closeSync(held.fd);}
    `,staging,phase,new URL('./exporter-seed.mjs',import.meta.url).href],{encoding:'utf8',timeout:10000,maxBuffer:65536});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  }
});

test('a real interrupted copy cannot publish or later adopt a partial seed', async t => {
  const owner = fixture(t), seed = join(owner,'source'), destination = join(owner,'published');
  mkdirSync(join(seed,'.lake/build/bin'),{recursive:true});
  const bytes = Buffer.alloc(256*1024,0x5a);
  writeFileSync(join(seed,'.lake/build/bin/prod-export'),bytes,{mode:0o755});
  const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
  const driver = `import assert from 'node:assert/strict'; import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const [seed,destination,encoded,module] = process.argv.slice(1);
    const write = fs.writeSync; let paused = false;
    fs.writeSync = (...args) => {
      const count = write(...args);
      if (!paused && args[0] !== 1 && count > 0) {
        paused = true;
        const staged = fs.readlinkSync('/proc/self/fd/'+args[0]);
        write(1,JSON.stringify({staged,copied:count,pid:process.pid})+'\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);
        throw new Error('interruption control did not terminate the actual child');
      }
      return count;
    };
    syncBuiltinESMExports(); const {publishSeedFiles} = await import(module);
    publishSeedFiles(seed,destination,JSON.parse(encoded));
    assert.fail('interrupted publication must not complete');`;
  const child = spawn(process.execPath,['--input-type=module','-e',driver,seed,destination,JSON.stringify(manifest),
    new URL('./exporter-seed.mjs',import.meta.url).href],{stdio:['ignore','pipe','pipe']});
  const closed = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal)=>resolve({code,signal})); });
  let timer, observation, stdout='', stderr='';
  try {
    observation = await new Promise((resolve,reject) => {
      timer=setTimeout(()=>reject(new Error('actual copy did not reach its interruption barrier')),8000);
      child.stdout.on('data',data=>{
        stdout+=data; if(Buffer.byteLength(stdout)>65536){reject(new Error('interruption observation exceeded bound'));return;}
        if(stdout.includes('\n')){try{resolve(JSON.parse(stdout));}catch(error){reject(error);}}
      });
      child.stderr.on('data',data=>{stderr+=data;if(Buffer.byteLength(stderr)>65536)reject(new Error('interruption stderr exceeded bound'));});
      child.once('error',reject);
      child.once('close',()=>reject(new Error('copy exited before interruption: '+stderr)));
    });
    clearTimeout(timer);
    assert.equal(observation.pid,child.pid);
    assert.equal(observation.copied,64*1024);
    assert(observation.staged.startsWith(owner+'/.exporter-publication-'));
    const partial=lstatSync(observation.staged);
    assert(partial.isFile()&&partial.size===observation.copied);
    assert(child.kill('SIGKILL'));
    assert.deepEqual(await closed,{code:null,signal:'SIGKILL'});
    assert(!existsSync(destination));
    assert(readFileSync(observation.staged).equals(bytes.subarray(0,observation.copied)));
    assert.deepEqual(snapshotTree(seed),manifest.files);
    const orphans=readdirSync(owner).filter(name=>name.startsWith('.exporter-publication-'));
    assert.equal(orphans.length,1,'SIGKILL leaves an explicitly unaccepted owned orphan');
    publishSeedFiles(seed,destination,manifest);
    assert.deepEqual(snapshotTree(destination).filter(row=>row.path!=='manifest.json'),manifest.files);
    assert(readFileSync(observation.staged).equals(bytes.subarray(0,observation.copied)),'fresh construction never adopts or rewrites the orphan');
    assert.equal(lstatSync(observation.staged).ino,partial.ino);
  } finally {
    clearTimeout(timer);
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    await closed;
  }
});

test('seed publication preserves declared modes and unprivileged readability under restrictive umask', t => {
  const owner = fixture(t), seed = join(owner, 'source');
  mkdirSync(join(seed, '.lake/build/bin'), {recursive: true});
  writeFileSync(join(seed, '.lake/build/bin/prod-export'), 'copy fixture, not executable acceptance', {mode: 0o755});
  const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
    const [owner, seed, encoded, module] = process.argv.slice(1);
    fs.cpSync = () => { throw new Error('recursive copy forbidden'); }; syncBuiltinESMExports();
    const {publishSeedFiles, snapshotTree} = await import(module);
    const manifest = JSON.parse(encoded), destination = join(owner, 'published');
    process.umask(0o077); publishSeedFiles(seed, destination, manifest);
    assert.equal(fs.lstatSync(destination).mode & 0o777, 0o755);
    assert.equal(fs.lstatSync(join(destination, 'manifest.json')).mode & 0o777, 0o444);
    assert.deepEqual(snapshotTree(destination).filter(row => row.path !== 'manifest.json'), manifest.files);
    assert.throws(() => publishSeedFiles(seed, destination, manifest), /cannot overwrite/);
    assert.deepEqual(fs.readdirSync(owner).sort(), ['published', 'source']);
    // Give the actual unprivileged process access through this fixture only.
    if (process.getuid() === 0) { fs.chmodSync(owner, 0o755); process.setgid(1000); process.setuid(1000); }
    assert.deepEqual(JSON.parse(fs.readFileSync(join(destination, 'manifest.json'))), manifest);
    assert.equal(fs.readFileSync(join(destination, '.lake/build/bin/prod-export'), 'utf8'), 'copy fixture, not executable acceptance');
  `, owner, seed, JSON.stringify(manifest), new URL('./exporter-seed.mjs', import.meta.url).href],
  {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
  assert.ifError(result.error); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('publication failures leave no destination or staging and never copy beyond declared bytes', t => {
  for (const phase of ['growth', 'extra', 'write-failure']) {
    const owner = fixture(t), seed = join(owner, 'source');
    mkdirSync(join(seed, '.lake/build/bin'), {recursive: true});
    const member = join(seed, '.lake/build/bin/prod-export');
    writeFileSync(member, 'bounded real file copy', {mode: 0o755});
    const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'; import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path';
      const [owner, seed, member, phase, encoded, module] = process.argv.slice(1);
      const open = fs.openSync, read = fs.readSync, write = fs.writeSync;
      let opens = 0, input, mutated = false, copied = 0;
      fs.cpSync = () => { throw new Error('recursive copy forbidden'); };
      fs.openSync = (...args) => {
        const fd = open(...args); if (fs.realpathSync(args[0]) === member && ++opens === 2) input = fd; return fd;
      };
      fs.readSync = (...args) => {
        const count = read(...args);
        if (phase === 'growth' && args[0] === input && count && !mutated) {
          fs.appendFileSync(member, 'unexpected growth'); mutated = true;
        }
        return count;
      };
      fs.writeSync = (...args) => {
        const count = write(...args); copied += count;
        if (!mutated && phase === 'extra') { fs.writeFileSync(join(seed, '.lake/extra'), 'extra'); mutated = true; }
        if (!mutated && phase === 'write-failure') { mutated = true; throw new Error('injected write failure after real write'); }
        return count;
      };
      syncBuiltinESMExports(); const {publishSeedFiles} = await import(module);
      const manifest = JSON.parse(encoded), destination = join(owner, 'published');
      const expected = phase === 'growth' ? /grew while copying/ : phase === 'extra' ? /changed during publication/ : /injected write failure/;
      assert.throws(() => publishSeedFiles(seed, destination, manifest), expected);
      assert(mutated); assert(copied <= manifest.files.at(-1).byte_length);
      assert.equal(fs.existsSync(destination), false);
      assert.deepEqual(fs.readdirSync(owner), ['source']);
    `, owner, seed, member, phase, JSON.stringify(manifest), new URL('./exporter-seed.mjs', import.meta.url).href],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error); assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('actual publication refuses a destination created after its last existence check', t => {
  for (const kind of ['directory', 'file', 'alias']) {
    const owner = fixture(t), seed = join(owner, 'source');
    mkdirSync(join(seed, '.lake/build/bin'), {recursive: true});
    writeFileSync(join(seed, '.lake/build/bin/prod-export'), 'bounded copy witness', {mode: 0o755});
    const manifest = manifestFixture(); manifest.files = snapshotTree(seed);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'; import fs from 'node:fs';
      import child from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
      import {join} from 'node:path';
      const [owner,seed,encoded,kind,module] = process.argv.slice(1), destination=join(owner,'published');
      const spawn=child.spawnSync;let raced=false,prior;
      child.spawnSync=(program,args,options)=>{
        assert.equal(program,'/usr/bin/python3');assert(!raced);raced=true;
        if(kind==='directory')fs.mkdirSync(destination);
        else if(kind==='file')fs.writeFileSync(destination,'foreign destination');
        else fs.symlinkSync(seed,destination);
        prior=fs.lstatSync(destination);return spawn(program,args,options);
      };
      syncBuiltinESMExports();const {publishSeedFiles}=await import(module);
      assert.throws(()=>publishSeedFiles(seed,destination,JSON.parse(encoded)),/exclusive exporter publication refused/);
      assert(raced);const current=fs.lstatSync(destination);
      for(const key of ['dev','ino','mode','size','uid','gid'])assert.equal(current[key],prior[key]);
      if(kind==='directory')assert.deepEqual(fs.readdirSync(destination),[]);
      else if(kind==='file')assert.equal(fs.readFileSync(destination,'utf8'),'foreign destination');
      else assert.equal(fs.readlinkSync(destination),seed);
      assert.deepEqual(fs.readdirSync(owner).sort(),['published','source']);
    `, owner, seed, JSON.stringify(manifest), kind, new URL('./exporter-seed.mjs', import.meta.url).href],
    {encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  }
});

test('publication refuses mutable and special-permission parent authority before becoming visible', t => {
  for (const mode of [0o777,0o775,0o1777,0o2755]) {
    const owner=fixture(t),seed=fixture(t),destination=join(owner,'published');
    chmodSync(owner,mode);assert.throws(()=>publishSeedFiles(seed,destination,manifestFixture()),/publication parent must be owned/);
  }
});

test('source admission rejects source bytes and entries at their own limits before reading or accumulating beyond them', t => {
  for (const phase of ['bytes','entries']) {
    const owner=fixture(t),source=join(owner,'source'),seed=join(owner,'seed');mkdirSync(source);mkdirSync(seed);
    const member=join(source,'member');writeFileSync(member,'original source');
    const manifest={source_files:snapshotTree(source),files:[]};
    if(phase==='bytes')truncateSync(member,16*1024**2+1);
    else for(let index=0;index<4096;index++)writeFileSync(join(source,'entry-'+index),'');
    const result=spawnSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      const [source,seed,member,phase,encoded,module]=process.argv.slice(1);const open=fs.openSync,stat=fs.lstatSync;
      let opened=0,observed=0;
      fs.openSync=(...args)=>{if(args[0]===member)opened++;return open(...args);};
      fs.lstatSync=(...args)=>{if(args[0].startsWith(source+'/'))observed++;return stat(...args);};
      syncBuiltinESMExports();const {verifySeedFiles}=await import(module);
      assert.throws(()=>verifySeedFiles(seed,source,JSON.parse(encoded)),phase==='bytes'?/bounded singly-linked/:/entry count exceeded/);
      if(phase==='bytes')assert.equal(opened,0);else assert(observed<=4096*3,'never observe the one-over entry');
    `,source,seed,member,phase,JSON.stringify(manifest),new URL('./exporter-seed-admission.mjs',import.meta.url).href],
    {encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  }
});

test('two actual publishers admit exactly one complete destination without replacing its winner', async t => {
  const owner=fixture(t),seed=join(owner,'source');mkdirSync(join(seed,'.lake/build/bin'),{recursive:true});
  writeFileSync(join(seed,'.lake/build/bin/prod-export'),'actual bounded publication witness',{mode:0o755});
  const manifest=manifestFixture();manifest.files=snapshotTree(seed);
  const driver=`import {publishSeedFiles} from ${JSON.stringify(new URL('./exporter-seed.mjs',import.meta.url).href)};
    const [seed,destination,encoded]=process.argv.slice(1);
    try{publishSeedFiles(seed,destination,JSON.parse(encoded));}catch{process.exitCode=19;}`;
  const launch=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',driver,seed,join(owner,'published'),JSON.stringify(manifest)],
      {stdio:['ignore','ignore','pipe'],timeout:15000});let bytes=0;
    child.stderr.on('data',data=>{bytes+=data.length;if(bytes>65536)child.kill('SIGKILL');});
    child.on('error',reject);child.on('close',(code,signal)=>{try{assert.equal(signal,null);resolve(code);}catch(error){reject(error);}});
  });
  assert.deepEqual((await Promise.all([launch(),launch()])).sort((a,b)=>a-b),[0,19]);
  assert.deepEqual(snapshotTree(join(owner,'published')).filter(row=>row.path!=='manifest.json'),manifest.files);
  assert.deepEqual(snapshotTree(seed),manifest.files);
});

test('publication authority and source-budget regressions kill real production guard mutations', t => {
  const source=readFileSync(new URL('./exporter-seed.mjs',import.meta.url),'utf8');
  const admission=readFileSync(new URL('./exporter-seed-admission.mjs',import.meta.url),'utf8');
  for(const kind of ['no-replace','parent-authority','source-budget']){
    const owner=fixture(t),seed=join(owner,'source'),destination=join(owner,'published');
    mkdirSync(join(seed,'.lake/build/bin'),{recursive:true});writeFileSync(join(seed,'.lake/build/bin/prod-export'),'bounded real file',{mode:0o755});
    const manifest=manifestFixture();manifest.files=snapshotTree(seed);manifest.source_files=[];
    const replacements=kind==='no-replace'
      ?[['target_fd,os.fsencode(os.path.basename(destination)),1)','target_fd,os.fsencode(os.path.basename(destination)),0)']]
      :kind==='parent-authority'?[[' && (parent.mode & 0o7022) === 0',''],[' and not target.st_mode & 0o7022','']]
      :[['snapshotTree(source, {bounds: sourceBounds})','snapshotTree(source)']];
    let mutated=kind==='source-budget'?admission:source;
    for(const [before,after] of replacements){assert.equal(mutated.split(before).length,2);mutated=mutated.replace(before,after);}
    for(const name of ['inventory-metadata','exporter-seed'])mutated=mutated.replaceAll("'./"+name+".mjs'",JSON.stringify(new URL('./'+name+'.mjs',import.meta.url).href));
    const module=join(owner,'mutant.mjs');writeFileSync(module,mutated);
    const driver=kind==='source-budget'
      ?`import fs from 'node:fs';const {verifySeedFiles}=await import(module);fs.truncateSync(member,16*1024**2+1);
        assert.throws(()=>verifySeedFiles(seed,seed,manifest),/bounded singly-linked/);`
      :`import fs from 'node:fs';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
        const spawn=child.spawnSync;child.spawnSync=(...args)=>{if(kind==='no-replace')fs.mkdirSync(destination);return spawn(...args);};
        syncBuiltinESMExports();const {publishSeedFiles}=await import(module);
        if(kind==='parent-authority')fs.chmodSync(owner,0o777);
        assert.throws(()=>publishSeedFiles(seed,destination,manifest),kind==='no-replace'?/exclusive exporter publication refused/:/publication parent must be owned/);`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';
      const [owner,seed,destination,encoded,kind,module,member]=process.argv.slice(1);const manifest=JSON.parse(encoded);${driver}`,
      owner,seed,destination,JSON.stringify(manifest),kind,new URL('file://'+module).href,join(seed,'.lake/build/bin/prod-export')],
      {encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,1);assert.match(result.stderr,/AssertionError/);
  }
});

test('replacing publication parent never deletes foreign content or publishes into its replacement', t => {
  for(const phase of ['replacement','mode-drift']){
    const owner=fixture(t),parent=join(owner,'parent'),seed=join(owner,'source');mkdirSync(parent);
    mkdirSync(join(seed,'.lake/build/bin'),{recursive:true});
    writeFileSync(join(seed,'.lake/build/bin/prod-export'),'bounded copy witness',{mode:0o755});
    writeFileSync(join(seed,'.lake/member'),'actual copy input');const manifest=manifestFixture();manifest.files=snapshotTree(seed);
    const result=spawnSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';import fs from 'node:fs';import child from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';
      const [owner,parent,seed,encoded,phase,module]=process.argv.slice(1),destination=join(parent,'published');
      const spawn=child.spawnSync;let changed=false,privatePath;
      child.spawnSync=(program,args,options)=>{
        const invocation=JSON.parse(args.at(-1));privatePath=join(invocation[0],'..');changed=true;
        if(phase==='replacement'){
          fs.renameSync(parent,join(owner,'saved-parent'));fs.mkdirSync(parent);fs.writeFileSync(join(parent,'foreign'),'foreign content');
          return spawn(program,args,options);
        }
        const result=spawn(program,args,options);assert.equal(result.status,0);fs.chmodSync(privatePath,0o777);return result;
      };
      syncBuiltinESMExports();const {publishSeedFiles}=await import(module);
      assert.throws(()=>publishSeedFiles(seed,destination,JSON.parse(encoded)));assert(changed);
      if(phase==='replacement'){
        assert.equal(fs.readFileSync(join(parent,'foreign'),'utf8'),'foreign content');assert(!fs.existsSync(destination));
        assert.equal(fs.readdirSync(join(owner,'saved-parent')).length,1,'unknown private owner is preserved');
      }else{
        assert(fs.existsSync(destination),'late uncertainty does not delete an already published destination');
        assert(fs.existsSync(privatePath),'changed private mode forbids cleanup');
        assert.equal(fs.readFileSync(join(destination,'.lake/member'),'utf8'),'actual copy input');
      }
    `,owner,parent,seed,JSON.stringify(manifest),phase,new URL('./exporter-seed.mjs',import.meta.url).href],
    {encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
  }
});
