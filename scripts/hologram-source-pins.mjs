// Early source refusal only; the original Rust interoperability executions
// and independent imported Hologram/codec oracles remain mandatory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readlinkSync,readSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
export const pinnedPaths=Object.freeze([
 'crates/prismpm/vendor/hologram-live.tar',
 'crates/prismpm/src/embedded/hologram-oracle.browser.mjs',
 'tests/holo-codec-oracle/Cargo.toml',
 'tests/holo-codec-oracle/Cargo.lock',
]);
const identity=['dev','ino','uid','gid','mode','size','nlink','mtimeNs','ctimeNs'];
// Independently reviewed original Rust owner, including its active #[test].
// Literal text in a comment/raw string cannot substitute for these bytes.
const reviewedOwner='33dd5dcadc21e2afb16f2bb239c09da4294c3390025935d0530f8b7ef4e353a6';
function digest(path,capture=false){
 assert.equal(realpathSync(dirname(path)),dirname(path),'source ancestor alias');
 const before=lstatSync(path,{bigint:true});assert(before.isFile()&&before.nlink===1n&&before.size<=(capture?1n:64n)*1024n**2n);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const same=stat=>{for(const name of identity)assert.equal(stat[name],before[name],'source identity changed');};same(fstatSync(fd,{bigint:true}));
  const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024),chunks=[];let length=0;
  for(;;){const count=readSync(fd,buffer,0,buffer.length,null);if(!count)break;length+=count;assert(BigInt(length)<=before.size);hash.update(buffer.subarray(0,count));if(capture)chunks.push(Buffer.from(buffer.subarray(0,count)));}
  assert.equal(BigInt(length),before.size);same(fstatSync(fd,{bigint:true}));same(lstatSync(path,{bigint:true}));
  assert.equal(realpathSync(path),path);const sha256=hash.digest('hex');return capture?
   {source:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),sha256}:sha256;
 }finally{closeSync(fd);}
}
export function verifyHologramSourcePins(root){
 root=resolve(root);assert.equal(realpathSync(root),root);
 const owner=digest(join(root,'crates/prismpm/tests/hologram_interop.rs'),true);assert.equal(owner.sha256,reviewedOwner,'original active Rust interoperability owner changed');
 const rows=[...owner.source.matchAll(/assert_eq!\(\s*sha256_file\(&r\.join\("([^"]+)"\)\),\s*"([a-f0-9]{64})",/g)];
 assert.deepEqual(rows.map(row=>row[1]),pinnedPaths,'complete original frozen source pin assertions required');
 for(const row of rows){
  let relative=row[1];
  if(relative==='crates/prismpm/vendor/hologram-live.tar'){
   const alias=join(root,'crates/prismpm/vendor');assert(lstatSync(alias).isSymbolicLink());assert.equal(readlinkSync(alias),'../../vendor');
   relative='vendor/hologram-live.tar';
  }
  assert.equal(digest(join(root,relative)),row[2],'reviewed Hologram source pin differs: '+row[1]);
 }
 return rows.map(row=>({path:row[1],sha256:row[2]}));
}
