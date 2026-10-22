// Small real filesystem fixtures, never substitute compiler/feature evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createSessionProductRetention} from './workspace-products.mjs';

function fixture(t) {
  const compiler = fs.mkdtempSync(join(tmpdir(),'prismpm-compiler-owner-'));
  const source = fs.mkdtempSync(join(tmpdir(),'prismpm-session-'));
  t.after(() => {fs.rmSync(compiler,{recursive:true,force:true}); fs.rmSync(source,{recursive:true,force:true});});
  fs.mkdirSync(join(source,'generated')); fs.writeFileSync(join(source,'generated/lib.rs'),'actual fixture bytes\n');
  fs.writeFileSync(join(source,'empty'),'');
  return {compiler,source,sink:createSessionProductRetention(compiler)};
}
const sha = value => createHash('sha256').update(value).digest('hex');

test('complete products survive real source deletion with literal links and independent file bytes', t => {
  const f = fixture(t), original = join(f.source,'generated/lib.rs');
  fs.linkSync(original,join(f.source,'hardlink')); fs.symlinkSync('/never/read/external-target',join(f.source,'literal'));
  const rawTarget=Buffer.from([0xff,0xfe,0x2f,0x61]);fs.symlinkSync(rawTarget,join(f.source,'literal-non-utf8'));
  const row = f.sink.capture(f.source), bytes = fs.readFileSync(join(row.directory,'capture.json'));
  assert.equal(sha(bytes),row.manifest_sha256);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema,'prismpm/retained-session-products/1');
  assert.equal(manifest.original.rows.find(row=>row.path==='hardlink').identity.nlink,'2');
  assert.equal(manifest.copied.rows.find(row=>row.path==='hardlink').identity.nlink,'1');
  assert.equal(fs.readlinkSync(join(row.directory,'products/literal')),'/never/read/external-target');
  assert.deepEqual(fs.readlinkSync(join(row.directory,'products/literal-non-utf8'),{encoding:'buffer'}),rawTarget);
  assert.equal(manifest.original.rows.find(row=>row.path==='literal-non-utf8').target_base64,rawTarget.toString('base64'));
  fs.rmSync(f.source,{recursive:true});
  assert.equal(fs.lstatSync(f.source,{throwIfNoEntry:false}),undefined,'source really deleted');
  const checked = f.sink.verify(); assert.equal(checked.snapshots.length,1);
  assert.equal(checked.bytes,row.bytes); assert(Object.isFrozen(checked.snapshots[0]));
  assert.equal(fs.readFileSync(join(row.directory,'products/generated/lib.rs'),'utf8'),'actual fixture bytes\n');
  f.sink.verify();
});

test('every later verification rejects actual retained-copy substitution and inventory drift', t => {
  for (const kind of ['bytes','same-bytes-inode','mode','hardlink','symlink','deleted','extra-file','extra-directory']) {
    const f = fixture(t), row = f.sink.capture(f.source); f.sink.verify();
    const path = join(row.directory,'products/generated/lib.rs'), bytes = fs.readFileSync(path);
    if (kind==='bytes') fs.writeFileSync(path,Buffer.concat([bytes,Buffer.from('changed')]));
    if (kind==='same-bytes-inode') {fs.renameSync(path,path+'.held'); fs.writeFileSync(path,bytes); fs.unlinkSync(path+'.held');}
    if (kind==='mode') fs.chmodSync(path,0o400);
    if (kind==='hardlink') fs.linkSync(path,join(f.compiler,'extra-link'));
    if (kind==='symlink') {fs.unlinkSync(path); fs.symlinkSync('/never/read/external-target',path);}
    if (kind==='deleted') fs.unlinkSync(path);
    if (kind==='extra-file') fs.writeFileSync(join(row.directory,'products/extra'),'extra');
    if (kind==='extra-directory') fs.mkdirSync(join(row.directory,'products/extra'));
    assert.throws(() => f.sink.verify(),undefined,'actual '+kind+' cannot reuse successful capture');
    assert(fs.existsSync(f.source),'a diagnostic copy is not authority to delete live products');
  }
});

test('manifest and snapshot-parent custody cannot be replaced with coherent identical bytes', t => {
  for (const kind of ['manifest-bytes','manifest-inode','manifest-mode','snapshot-parent','extra-root']) {
    const f = fixture(t), row = f.sink.capture(f.source), path = join(row.directory,'capture.json');
    f.sink.verify();
    if (kind==='manifest-bytes') {fs.chmodSync(path,0o600); fs.writeFileSync(path,'{}\n');}
    if (kind==='manifest-inode') {const bytes=fs.readFileSync(path); fs.renameSync(path,path+'.held'); fs.writeFileSync(path,bytes,{mode:0o400}); fs.unlinkSync(path+'.held');}
    if (kind==='manifest-mode') fs.chmodSync(path,0o600);
    if (kind==='snapshot-parent') {
      fs.renameSync(row.directory,row.directory+'.held'); fs.mkdirSync(row.directory,{mode:0o700});
      for (const name of ['products','capture.json']) fs.renameSync(join(row.directory+'.held',name),join(row.directory,name));
      fs.rmdirSync(row.directory+'.held');
    }
    if (kind==='extra-root') fs.mkdirSync(join(f.compiler,'retained-session-products/extra'));
    assert.throws(() => f.sink.verify(),undefined,kind);
  }
});

test('root aliases, permission changes and identical-name replacement refuse before acceptance', t => {
  for (const kind of ['owner-mode','retention-mode','owner-inode','retention-inode','retention-alias']) {
    const f = fixture(t), retention = join(f.compiler,'retained-session-products');
    f.sink.capture(f.source); f.sink.verify();
    if (kind==='owner-mode') fs.chmodSync(f.compiler,0o755);
    if (kind==='retention-mode') fs.chmodSync(retention,0o755);
    if (kind==='owner-inode') {
      const saved=f.compiler+'.held'; fs.renameSync(f.compiler,saved); fs.mkdirSync(f.compiler,{mode:0o700});
      fs.renameSync(join(saved,'retained-session-products'),retention); fs.rmdirSync(saved);
    }
    if (kind==='retention-inode') {
      const saved=retention+'.held'; fs.renameSync(retention,saved); fs.mkdirSync(retention,{mode:0o700});
      for (const name of fs.readdirSync(saved)) fs.renameSync(join(saved,name),join(retention,name)); fs.rmdirSync(saved);
    }
    if (kind==='retention-alias') {const saved=retention+'.held'; fs.renameSync(retention,saved); fs.symlinkSync(saved,retention);}
    assert.throws(() => f.sink.verify(),undefined,kind);
  }
});

test('nonregular and over-limit original products fail before deletion or allocation', t => {
  for (const kind of ['fifo','oversize','excess-links','special-mode']) {
    const f=fixture(t), path=join(f.source,'unsafe');
    if (kind==='fifo') execFileSync('/usr/bin/mkfifo',[path]);
    if (kind==='oversize') {const fd=fs.openSync(path,'wx'); try {fs.ftruncateSync(fd,512*1024**2+1);} finally {fs.closeSync(fd);}}
    if (kind==='excess-links') {
      fs.writeFileSync(path,'x'); for(let index=0;index<64;index++) fs.linkSync(path,join(f.source,'link-'+index));
    }
    if (kind==='special-mode') {fs.writeFileSync(path,'x'); fs.chmodSync(path,0o666);}
    assert.throws(() => f.sink.capture(f.source),/nonregular|bounded owned regular/);
    assert(fs.existsSync(f.source),'failed capture must not delete source products');
  }
});

test('the original depth and root-count bounds reject complete over-limit inventories', t => {
  const deep=fixture(t); let directory=deep.source;
  for(let index=0;index<65;index++) {directory=join(directory,'d'); fs.mkdirSync(directory);}
  assert.throws(() => deep.sink.capture(deep.source),/bounded product inventory/);
  const f=fixture(t), sources=[];
  t.after(() => sources.forEach(path=>fs.rmSync(path,{recursive:true,force:true})));
  for(let index=0;index<32;index++) {
    const source=fs.mkdtempSync(join(tmpdir(),'prismpm-session-')); sources.push(source); f.sink.capture(source);
  }
  assert.equal(f.sink.verify().snapshots.length,32);
  assert.throws(() => f.sink.capture(f.source),/retained product root bound/);
});

test('changes during the actual descriptor read cannot produce an accepted copy', t => {
  for (const phase of ['initial','copy','final-source']) {
    const f=fixture(t), target=join(f.source,'generated/lib.rs'), original=fs.readFileSync(target);
    const open=fs.openSync, read=fs.readSync, descriptors=new Map(); let opens=0, changed=false;
    try {
      fs.openSync=function(path,...args) {const fd=open(path,...args); descriptors.set(fd,path); if(path===target) opens++; return fd;};
      fs.readSync=function(fd,...args) {
        const count=read(fd,...args);
        if(count>0&&!changed&&descriptors.get(fd)===target&&opens==={initial:1,copy:2,'final-source':3}[phase]) {
          changed=true; fs.writeFileSync(target,Buffer.concat([original,Buffer.from('changed during read')]));
        }
        return count;
      };
      syncBuiltinESMExports();
      assert.throws(() => f.sink.capture(f.source),/product (grew|shortened)|stable original products?|stable original product/);
      assert(changed,'actual '+phase+' descriptor triggered substitution');
    } finally {fs.openSync=open; fs.readSync=read; syncBuiltinESMExports();}
    assert(fs.existsSync(f.source));
  }
});

test('changing an early source while a later member is read is caught by the final name sweep', t => {
  const f=fixture(t), early=join(f.source,'empty'), later=join(f.source,'generated/lib.rs');
  const open=fs.openSync, read=fs.readSync, descriptors=new Map(); let changed=false;
  try {
    fs.openSync=function(path,...args) {const fd=open(path,...args); descriptors.set(fd,path); return fd;};
    fs.readSync=function(fd,...args) {const count=read(fd,...args); if(count>0&&!changed&&descriptors.get(fd)===later) {
      changed=true; fs.writeFileSync(early,'late modification');
    } return count;};
    syncBuiltinESMExports(); assert.throws(() => f.sink.capture(f.source),/stable original product|final complete product descriptor/); assert(changed);
  } finally {fs.openSync=open; fs.readSync=read; syncBuiltinESMExports();}
});

test('late manifest, closed-namespace and earlier-snapshot changes fail the final cross-snapshot sweep', t => {
  for(const kind of ['manifest','snapshot-entry','root-entry','earlier-copy','earlier-manifest']) {
    const f=fixture(t), first=f.sink.capture(f.source);
    const other=fs.mkdtempSync(join(tmpdir(),'prismpm-session-'));
    t.after(()=>fs.rmSync(other,{recursive:true,force:true}));
    fs.writeFileSync(join(other,'later'),'later real product');
    const second=f.sink.capture(other); f.sink.verify();
    const trigger=join(second.directory,'products/later');
    const open=fs.openSync,read=fs.readSync,descriptors=new Map(); let changed=false;
    try {
      fs.openSync=function(path,...args) {const fd=open(path,...args);descriptors.set(fd,path);return fd;};
      fs.readSync=function(fd,...args) {const count=read(fd,...args);
        if(count>0&&!changed&&descriptors.get(fd)===trigger) {
          changed=true;
          if(kind==='manifest'||kind==='earlier-manifest') {
            const path=join((kind==='manifest'?second:first).directory,'capture.json');
            fs.chmodSync(path,0o600);fs.writeFileSync(path,'{}\n');
          }
          if(kind==='snapshot-entry') fs.writeFileSync(join(second.directory,'extra'),'outside closed snapshot inventory');
          if(kind==='root-entry') fs.mkdirSync(join(f.compiler,'retained-session-products/extra'));
          if(kind==='earlier-copy') fs.writeFileSync(join(first.directory,'products/empty'),'late product substitution');
        }
        return count;
      };
      syncBuiltinESMExports(); assert.throws(()=>f.sink.verify(),undefined,kind);assert(changed);
    } finally {fs.openSync=open;fs.readSync=read;syncBuiltinESMExports();}
  }
});

test('per-capture verification requires the actual immutable receipt and keeps namespace closure', t=>{
  const f=fixture(t), receipt=f.sink.capture(f.source);
  assert.equal(f.sink.verifyCapture(receipt),receipt);
  assert.throws(()=>f.sink.verifyCapture({...receipt}),/original retained-product receipt/);
  fs.writeFileSync(join(receipt.directory,'products/empty'),'changed');
  assert.throws(()=>f.sink.verifyCapture(receipt));
});

test('a destination ancestor swapped for a symlink cannot create an outside product', t=>{
  const f=fixture(t),outside=fs.mkdtempSync(join(tmpdir(),'prismpm-product-outside-'));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  const mkdir=fs.mkdirSync;let swapped=false;
  try {
    fs.mkdirSync=function(path,...args) {
      const value=mkdir(path,...args);
      if(String(path).startsWith('/proc/self/fd/')&&String(path).endsWith('/generated')&&!swapped) {
        swapped=true;fs.rmdirSync(path);fs.symlinkSync(outside,path);
      }
      return value;
    };
    syncBuiltinESMExports();assert.throws(()=>f.sink.capture(f.source));assert(swapped);
  } finally {fs.mkdirSync=mkdir;syncBuiltinESMExports();}
  assert.deepEqual(fs.readdirSync(outside),[],'no leaf was written through the substituted ancestor');
  assert(fs.existsSync(join(f.source,'generated/lib.rs')));
});

test('disk admission includes metadata allocation and an untouched one-GiB reserve', t=>{
  const f=fixture(t),statfs=fs.statfsSync;
  try {
    fs.statfsSync=()=>({bavail:1024**3/4096+1,bsize:4096});syncBuiltinESMExports();
    assert.throws(()=>f.sink.capture(f.source),/complete product allocation plus one-GiB/);
  } finally {fs.statfsSync=statfs;syncBuiltinESMExports();}
  assert.deepEqual(fs.readdirSync(join(f.compiler,'retained-session-products')),[],'no allocation before complete resource admission');
});

test('pending ancestor names and metadata are bounded before buffering or copying', t=>{
  // Inject directory enumeration only to exercise otherwise expensive admission
  // limits. These resource units are not compiler or feature acceptance.
  for(const kind of ['pending','metadata']) {
    const f=fixture(t); fs.mkdirSync(join(f.source,'a'));
    const opendir=fs.opendirSync;let discovered=0;
    try {
      fs.opendirSync=function(path,...args) {
        if(path!==f.source&&path!==join(f.source,'a')) return opendir(path,...args);
        const nested=path!==f.source;let index=0;
        return {closeSync(){},readSync(){
          if(index++ >= (nested?2:199999)) return null;
          discovered++;
          return {name:!nested&&index===1?'a':('z'.repeat(kind==='metadata'?220:1)+String(index).padStart(6,'0'))};
        }};
      };
      syncBuiltinESMExports();
      assert.throws(()=>f.sink.capture(f.source),kind==='pending'?/bounded product directory/:/bounded complete product metadata/);
    } finally {fs.opendirSync=opendir;syncBuiltinESMExports();}
    assert(discovered>1);assert.deepEqual(fs.readdirSync(join(f.compiler,'retained-session-products')),[]);
  }
});

test('a missing original, aliased source or unowned preexisting sink cannot be adopted', t => {
  const f=fixture(t);
  assert.throws(() => createSessionProductRetention(f.compiler),/EEXIST/);
  assert.throws(() => f.sink.capture(join(tmpdir(),'prismpm-session-missing')),/ENOENT/);
  const alias=fs.mkdtempSync(join(tmpdir(),'prismpm-session-')); fs.rmdirSync(alias); fs.symlinkSync(f.source,alias);
  t.after(() => fs.unlinkSync(alias)); assert.throws(() => f.sink.capture(alias),/unaliased/);
  assert.throws(() => createSessionProductRetention(f.source));
  assert.throws(() => f.sink.capture(f.source+'/../'+f.source.split('/').at(-1)),/normalized|workspace parent/);
});
