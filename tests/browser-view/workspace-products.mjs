// Original test products only: a retained copy never authorizes execution or
// replaces live custody, source verification, retirement, or deletion checks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync,
  opendirSync, readlinkSync, readSync, realpathSync, statfsSync,
  symlinkSync, writeFileSync, writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';

const fields = ['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'];
const maximum = {file:512 * 1024 ** 2, bytes:8 * 1024 ** 3, entries:200000, roots:32, depth:64,
  metadata:32 * 1024 ** 2, manifest:96 * 1024 ** 2};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => Object.fromEntries(fields.map(key => [key,stat[key].toString()]));
const freeze = value => {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
};
function privateDirectory(path) {
  assert.equal(resolve(path),path,'normalized retained-product directory');
  assert.equal(realpathSync(path),path,'unaliased retained-product directory');
  const stat = lstatSync(path,{bigint:true});
  assert(stat.isDirectory() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n,
    'private owned retained-product directory');
  return stat;
}
function same(before, after) {
  assert.deepEqual(identity(after),identity(before),'stable original product descriptor and name');
}
function directoryNames(path, limit) {
  const names=[], directory=opendirSync(path,{bufferSize:32});
  try {for(let entry;(entry=directory.readSync())!==null;) {
    assert(names.length<limit,'bounded retained directory'); names.push(entry.name);
  }} finally {directory.closeSync();}
  return names.sort();
}
function directoryFd(path, expected) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {same(expected,fstatSync(fd,{bigint:true})); return fd;}
  catch(error) {closeSync(fd); throw error;}
}
const anchored = (fd,name) => '/proc/self/fd/'+fd+'/'+name;
// No content reads: a final sweep after the last content read detects changes
// to an earlier member, manifest or namespace during later descriptor reads.
function sweep(root, rows) {
  for(const row of rows) {
    const path=join(root,row.path), stat=lstatSync(path,{bigint:true});
    assert.deepEqual(identity(stat),row.identity,'final complete product descriptor sweep');
    if(row.kind==='symlink') assert.equal(readlinkSync(path,{encoding:'buffer'}).toString('base64'),row.target_base64,'final literal product link');
    else assert.equal(realpathSync(path),path,'final complete product ancestry');
  }
}
function regular(path, expected, destination = null) {
  assert.equal(realpathSync(path),path,'unaliased original product file');
  const fd = openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output;
  try {
    const before = fstatSync(fd,{bigint:true}); same(expected,before);
    assert(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink > 0n
      && before.nlink <= 64n && before.size <= BigInt(maximum.file) && (before.mode & 0o7022n) === 0n,
    'bounded owned regular original product');
    if (destination !== null) output = openSync(destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK,0o600);
    const chunk = Buffer.alloc(65536), digest = createHash('sha256'); let length = 0;
    for (;;) {
      const count = readSync(fd,chunk,0,Math.min(chunk.length,Number(before.size) - length + 1),null);
      if (!count) break;
      length += count; assert(length <= Number(before.size),'original product grew');
      digest.update(chunk.subarray(0,count));
      if (output !== undefined) for (let offset = 0; offset < count;) {
        const written = writeSync(output,chunk,offset,count - offset); assert(written > 0); offset += written;
      }
    }
    assert.equal(length,Number(before.size),'original product shortened');
    for (const after of [fstatSync(fd,{bigint:true}),lstatSync(path,{bigint:true})]) same(before,after);
    assert.equal(realpathSync(path),path,'original product ancestry changed');
    if (output !== undefined) {
      fchmodSync(output,Number(before.mode & 0o777n));
      const copied = fstatSync(output,{bigint:true});
      assert(copied.isFile() && copied.nlink === 1n && copied.size === before.size,'complete independent product copy');
      same(copied,lstatSync(destination,{bigint:true}));
    }
    return digest.digest('hex');
  } finally {if (output !== undefined) closeSync(output); closeSync(fd);}
}
function tree(root, copy = null, copyFd = null) {
  privateDirectory(root);
  const rows = []; let total = 0, discovered = 1, metadata = 0;
  function charge(bytes) {metadata+=bytes; assert(metadata<=maximum.metadata,'bounded complete product metadata');}
  function visit(path, relative, depth, parentFd) {
    assert(depth <= maximum.depth && path.length < 4096 && rows.length < maximum.entries,'bounded product inventory');
    const stat = lstatSync(path,{bigint:true});
    assert.equal(stat.uid,BigInt(process.getuid()),'owned original product');
    const row = {path:relative,identity:identity(stat)};
    charge(Buffer.byteLength(relative)+1024);
    const destination = copy === null || relative==='.' ? null : anchored(parentFd,basename(relative));
    if (stat.isDirectory()) {
      assert.equal(realpathSync(path),path,'unaliased original product directory');
      row.kind = 'directory'; rows.push(row);
      let fd=copyFd, owned=false;
      if(destination!==null) {
        mkdirSync(destination,{mode:0o700});
        fd=directoryFd(destination,lstatSync(destination,{bigint:true})); owned=true;
      }
      const names = [], directory = opendirSync(path,{bufferSize:32});
      try {
        try {for (let entry; (entry = directory.readSync()) !== null;) {
          // Includes names pending in every ancestor, not just visited rows.
          assert(++discovered <= maximum.entries,'bounded product directory');
          assert(/^[A-Za-z0-9_.+-]+$/.test(entry.name) && entry.name !== '.' && entry.name !== '..','closed product entry');
          charge(Buffer.byteLength(relative)+Buffer.byteLength(entry.name)+1);
          names.push(entry.name);
        }} finally {directory.closeSync();}
        for (const name of names.sort()) visit(join(path,name),relative === '.' ? name : relative + '/' + name,depth + 1,fd);
      } finally {if(owned) closeSync(fd);}
    } else if (stat.isSymbolicLink()) {
      row.kind = 'symlink'; const target=readlinkSync(path,{encoding:'buffer'});
      assert(target.length > 0 && target.length <= 4096 && !target.includes(0),'bounded literal product symlink');
      row.target_base64=target.toString('base64');charge(target.length);
      // Retain literal links, never read their target or claim external bytes.
      if (destination !== null) symlinkSync(target,destination);
      rows.push(row);
    } else {
      assert(stat.isFile(),'nonregular original product refused');
      total += Number(stat.size); assert(total <= maximum.bytes,'complete product byte bound');
      row.kind = 'file'; row.sha256 = regular(path,stat,destination); rows.push(row);
    }
    same(stat,lstatSync(path,{bigint:true}));
  }
  visit(root,'.',0,copyFd);
  sweep(root,rows);
  return {rows,total,metadata};
}
const contents = rows => rows.map(({path,kind,sha256,target_base64}) => ({path,kind,
  ...(sha256 === undefined ? {} : {sha256}),...(target_base64 === undefined ? {} : {target_base64})}));

export function createSessionProductRetention(compilerRoot) {
  assert.equal(dirname(compilerRoot),realpathSync(tmpdir()),'owned compiler retention parent');
  assert.match(basename(compilerRoot),/^prismpm-compiler-owner-[A-Za-z0-9]+$/);
  const owner = privateDirectory(compilerRoot);
  const root = join(compilerRoot,'retained-session-products');
  const initialFd=directoryFd(compilerRoot,owner);
  try {mkdirSync(anchored(initialFd,'retained-session-products'),{mode:0o700});}
  finally {closeSync(initialFd);}
  const initializedOwner=privateDirectory(compilerRoot);
  for(const key of ['dev','ino','uid','gid','mode']) assert.equal(initializedOwner[key],owner[key],'original compiler directory custody');
  const rootIdentity = privateDirectory(root), captures = []; let total = 0, entries = 0, metadata = 0;
  function boundary() {
    for (const [path,expected] of [[compilerRoot,owner],[root,rootIdentity]]) {
      const actual = privateDirectory(path);
      for (const key of ['dev','ino','uid','gid','mode']) assert.equal(actual[key],expected[key],'original retention root custody');
    }
  }
  function verify(selected=captures) {
    boundary(); const start=privateDirectory(root);
    const expectedNames=captures.map(row=>row.name).sort();
    assert.deepEqual(directoryNames(root,maximum.roots),expectedNames,'complete original retained-product roots');
    for (const capture of selected) {
      const path = join(root,capture.name); same(capture.directoryIdentity,privateDirectory(path));
      assert.deepEqual(directoryNames(path,2),['capture.json','products']);
      const manifestPath = join(path,'capture.json');
      assert.equal(regular(manifestPath,capture.manifestIdentity),capture.receipt.manifest_sha256,'immutable retained-product manifest');
      const actual = tree(join(path,'products'));
      assert.deepEqual(actual,capture.copy,'immutable complete retained-product copy');
    }
    // Read all manifests again before the final metadata-only global sweep.
    for(const capture of captures) assert.equal(regular(join(root,capture.name,'capture.json'),capture.manifestIdentity),
      capture.receipt.manifest_sha256,'final immutable retained-product manifest');
    for(const capture of captures) {
      const path=join(root,capture.name);
      sweep(join(path,'products'),capture.copy.rows);
      same(capture.manifestIdentity,lstatSync(join(path,'capture.json'),{bigint:true}));
      assert.deepEqual(directoryNames(path,2),['capture.json','products']);
      same(capture.directoryIdentity,privateDirectory(path));
    }
    assert.deepEqual(directoryNames(root,maximum.roots),expectedNames,'final complete retained-product roots');
    same(start,privateDirectory(root));
    boundary();
    return freeze({scope:'original-test-products-only',directory:root,bytes:total,entries,
      snapshots:captures.map(row=>row.receipt)});
  }
  return Object.freeze({verify:()=>verify(),verifyCapture(receipt) {
    const captured=captures.find(row=>row.receipt===receipt);
    assert(captured,'original retained-product receipt required');
    verify([captured]); return receipt;
  },capture(source) {
    boundary(); assert(captures.length < maximum.roots,'retained product root bound');
    assert.equal(dirname(source),realpathSync(tmpdir()),'original session workspace parent');
    assert.match(basename(source),/^prismpm-session-[A-Za-z0-9]+$/);
    assert.notEqual(source,compilerRoot);
    const original = tree(source);
    assert(total + original.total <= maximum.bytes && entries + original.rows.length <= maximum.entries
      && metadata + original.metadata <= maximum.metadata,
      'complete aggregate retained-product bound');
    const disk = statfsSync(root);
    const allocation=original.total+original.rows.length*Number(disk.bsize)+maximum.manifest;
    assert(disk.bavail * disk.bsize >= allocation + 1024 ** 3,'complete product allocation plus one-GiB filesystem reserve');
    const name = String(captures.length + 1).padStart(4,'0') + '-' + basename(source);
    const destination = join(root,name), products = join(destination,'products');
    const ownerFd=directoryFd(compilerRoot,privateDirectory(compilerRoot)); let rootFd,snapshotFd,productsFd;
    try {
      rootFd=directoryFd(anchored(ownerFd,'retained-session-products'),privateDirectory(root));
      boundary(); mkdirSync(anchored(rootFd,name),{mode:0o700});
      snapshotFd=directoryFd(anchored(rootFd,name),privateDirectory(destination));
      mkdirSync(anchored(snapshotFd,'products'),{mode:0o700});
      productsFd=directoryFd(anchored(snapshotFd,'products'),privateDirectory(products));
      const observed = tree(source,products,productsFd); assert.deepEqual(observed,original,'stable original products while copying');
    const copied = tree(products);
    assert.deepEqual(contents(copied.rows),contents(original.rows),'complete source-to-retained-product byte join');
    assert.equal(copied.total,original.total);
    assert.deepEqual(tree(source),original,'original products remain unchanged before retirement');
    const manifest = Buffer.from(JSON.stringify({schema:'prismpm/retained-session-products/1',
      scope:'original-test-products-only',source,original,copied}) + '\n');
    assert(manifest.length<=maximum.manifest,'bounded complete product manifest');
    writeFileSync(anchored(snapshotFd,'capture.json'),manifest,{flag:'wx',mode:0o400});
    const receipt = freeze({directory:destination,source,bytes:original.total,entries:original.rows.length,
      manifest_sha256:hash(manifest)});
    captures.push({name,receipt,copy:copied,directoryIdentity:privateDirectory(destination),
      manifestIdentity:lstatSync(join(destination,'capture.json'),{bigint:true})});
    total += original.total; entries += original.rows.length; metadata += original.metadata;
    boundary(); return receipt;
    } finally {for(const fd of [productsFd,snapshotFd,rootFd,ownerFd]) if(fd!==undefined) closeSync(fd);}
  }});
}
