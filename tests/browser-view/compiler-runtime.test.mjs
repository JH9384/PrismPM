import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureCompilerRuntime} from './compiler-owner.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'prismpm-runtime-bound-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  return root;
}
function sparse(path, size) {
  const fd = fs.openSync(path, 'wx', 0o600);
  try { fs.ftruncateSync(fd, size); } finally { fs.closeSync(fd); }
}
function hook(t, name, replacement) {
  t.mock.method(fs, name, replacement);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test('runtime admits both complete entry budgets and the independent captured archive', t => {
  const root = fixture(t);
  fs.mkdirSync(join(root,'.lake'), 0o700);
  for (let n=0;n<4096;n++) fs.writeFileSync(join(root,`source-${n}`),'', {mode:0o600});
  for (let n=0;n<4095;n++) fs.writeFileSync(join(root,'.lake',`build-${n}`),'', {mode:0o600});
  fs.writeFileSync(join(root,'.source-lean.tar'),'archive', {mode:0o600});
  const rows = captureCompilerRuntime(root);
  assert.equal(Object.keys(rows).length,8194);
  assert(Object.isFrozen(rows));
  assert(Object.values(rows).every(Object.isFrozen));
  const names = Object.keys(rows);
  assert.deepEqual(names,[...names].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))));
  fs.writeFileSync(join(root,'source-extra'),'');
  assert.throws(()=>captureCompilerRuntime(root),/source entry count exceeded/);
  fs.unlinkSync(join(root,'source-extra'));
  fs.writeFileSync(join(root,'.lake','build-extra'),'');
  assert.throws(()=>captureCompilerRuntime(root),/build entry count exceeded/);
});

test('runtime streams exact source/build byte limits and refuses one byte over', t => {
  const root=fixture(t); fs.mkdirSync(join(root,'.lake'),0o700);
  sparse(join(root,'source'),16*1024**2);
  sparse(join(root,'.lake','first'),256*1024**2);
  sparse(join(root,'.lake','second'),256*1024**2);
  fs.writeFileSync(join(root,'.source-lean.tar'),'archive',{mode:0o600});
  const alloc=Buffer.alloc.bind(Buffer); let maximum=0;
  t.mock.method(Buffer,'alloc',size=>{maximum=Math.max(maximum,size);return alloc(size);});
  const rows=captureCompilerRuntime(root);
  assert.equal(rows['./source'].size,16*1024**2);
  assert.equal(rows['./.lake/second'].size,256*1024**2);
  assert(maximum<=64*1024,'runtime hashing must not allocate whole files');
  fs.writeFileSync(join(root,'source-extra'),'x',{mode:0o600});
  assert.throws(()=>captureCompilerRuntime(root),/source byte count exceeded/);
  fs.unlinkSync(join(root,'source-extra'));
  fs.writeFileSync(join(root,'.lake','extra'),'x',{mode:0o600});
  assert.throws(()=>captureCompilerRuntime(root),/build byte count exceeded/);
});

test('runtime walks deep admitted trees with one bounded directory iterator', t => {
  const root=fixture(t); let path=root;
  for(let n=0;n<80;n++){path=join(path,'d');fs.mkdirSync(path,0o700);}
  fs.writeFileSync(join(path,'leaf'),'value',{mode:0o600});
  const open=fs.opendirSync; let live=0, maximum=0;
  hook(t,'readdirSync',()=>{throw Error('unbounded directory materialization');});
  hook(t,'opendirSync',(path,options)=>{
    assert.equal(options.bufferSize,1);
    const stream=open(path,options); live++;maximum=Math.max(maximum,live);
    const close=stream.closeSync.bind(stream);
    stream.closeSync=()=>{try{return close();}finally{live--;}};
    return stream;
  });
  assert.equal(Object.keys(captureCompilerRuntime(root)).length,82);
  assert.equal(maximum,1);assert.equal(live,0);
});

test('runtime rechecks an already observed file after the remaining tree', t => {
  const root=fixture(t), first=join(root,'first');
  fs.writeFileSync(first,'a',{mode:0o600});fs.writeFileSync(join(root,'second'),'b',{mode:0o600});
  const open=fs.opendirSync;let changed=false;
  hook(t,'opendirSync',(path,options)=>{
    const stream=open(path,options),close=stream.closeSync.bind(stream);
    stream.closeSync=()=>{
      close();
      // All children have been read and captured, independent of filesystem
      // enumeration order. Child chmod does not alter the parent's identity.
      assert.equal(path,root);changed=true;fs.chmodSync(first,0o400);
    };
    return stream;
  });
  assert.throws(()=>captureCompilerRuntime(root),/stable compiler source/);
  assert(changed);
});

test('runtime rechecks queued directory identity before descending', t => {
  const root=fixture(t), child=join(root,'child');fs.mkdirSync(child,0o700);
  const open=fs.opendirSync;let changed=false;
  hook(t,'opendirSync',(path,options)=>{
    assert.equal(path,root,'queued child must be refused before opening');
    const stream=open(path,options),close=stream.closeSync.bind(stream);
    stream.closeSync=()=>{close();changed=true;fs.chmodSync(child,0o500);};
    return stream;
  });
  assert.throws(()=>captureCompilerRuntime(root),/stable compiler source/);assert(changed);
});

test('runtime admits the independent 256 MiB archive and refuses one byte over', t => {
  const root=fixture(t), archive=join(root,'.source-lean.tar');sparse(archive,256*1024**2);
  assert.equal(captureCompilerRuntime(root)['./.source-lean.tar'].size,256*1024**2);
  const fd=fs.openSync(archive,'r+');try{fs.ftruncateSync(fd,256*1024**2+1);}finally{fs.closeSync(fd);}
  assert.throws(()=>captureCompilerRuntime(root),/bounded regular exporter runtime input/);
});

test('runtime rejects concurrent file growth through the actual open descriptor', t => {
  const root=fixture(t), file=join(root,'file');fs.writeFileSync(file,'a',{mode:0o600});
  const read=fs.readSync;let changed=false;
  hook(t,'readSync',(...args)=>{
    const count=read(...args);
    if(count&&!changed){changed=true;fs.appendFileSync(file,'b');}
    return count;
  });
  assert.throws(()=>captureCompilerRuntime(root),/compiler source grew/);assert(changed);
});

test('runtime rejects non-directory roots, special permissions and aliases', t => {
  const root=fixture(t), file=join(root,'file');fs.writeFileSync(file,'a',{mode:0o600});
  assert.throws(()=>captureCompilerRuntime(file),/root must be a directory/);
  fs.chmodSync(file,0o4600);
  assert.throws(()=>captureCompilerRuntime(root),/special permissions/);
  for (const mode of [0o620, 0o602, 0o666]) {
    fs.chmodSync(file,mode);
    assert.throws(()=>captureCompilerRuntime(root),/group\/other writable: \.\/file/);
  }
  fs.chmodSync(file,0o600);fs.chmodSync(root,0o770);
  assert.throws(()=>captureCompilerRuntime(root),/group\/other writable: \.\n/);
  fs.chmodSync(root,0o700);
  fs.chmodSync(file,0o600);fs.linkSync(file,join(root,'alias'));
  assert.throws(()=>captureCompilerRuntime(root),/single-link/);
  fs.unlinkSync(join(root,'alias'));fs.symlinkSync(file,join(root,'alias'));
  assert.throws(()=>captureCompilerRuntime(root),/unaliased/);
});
