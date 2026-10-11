// Private Linux descriptor custody for original OCI tar bytes, not an extractor
// or installed-SDK acceptance. Handles are minted only after whole-ZIP admission.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {constants,closeSync,fchmodSync,fstatSync,fsyncSync,lstatSync,openSync,
 readSync,realpathSync,statfsSync,unlinkSync,writeSync} from 'node:fs';
import {resolve} from 'node:path';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {constructionIntegrityArchive} from './sdk-construction-archive.mjs';

const stages=new WeakMap(),reserve=12*1024**3;
const fields=['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'];
const equal=(a,b,keys=fields)=>{for(const key of keys)assert.equal(a[key],b[key],'staged OCI custody changed: '+key);};
const bounded=n=>assert(Number.isSafeInteger(n)&&n>0&&n<=64*1024**3);
const digest=d=>assert.match(d,/^sha256:[0-9a-f]{64}$/);
const deadline=end=>assert(performance.now()<=end,'staged OCI deadline exceeded');
const available=fd=>{const s=statfsSync('/proc/self/fd/'+fd,{bigint:true});return s.bavail*s.bsize;};
function rootCustody(row){
 const actual=fstatSync(row.root,{bigint:true});
 equal(actual,row.directory,['dev','ino','mode','uid','gid']);
 equal(lstatSync(row.path,{bigint:true}),actual,['dev','ino','mode','uid','gid']);
 assert.equal(realpathSync(row.path),row.path,'staging directory aliases refused');
}
function fileCustody(row){
 const actual=fstatSync(row.fd,{bigint:true});
 assert(actual.isFile()&&actual.nlink===1n,'single owned regular OCI stage required');
 equal(lstatSync(row.file,{bigint:true}),actual);
 if(row.sealed)equal(actual,row.sealed);
 else if(row.created)equal(actual,row.created,['dev','ino','uid','gid','nlink']);
 return actual;
}
function owned(handle){const row=stages.get(handle);assert(row&&!row.retired&&!row.active,'live exclusive OCI stage handle required');rootCustody(row);fileCustody(row);return row;}
async function hashFile(row,end,onChunk){
 const before=fileCustody(row),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
 while(bytes<row.archive.byte_length){
  deadline(end);const n=readSync(row.fd,buffer,0,Math.min(buffer.length,row.archive.byte_length-bytes),bytes);
  assert(n>0,'staged OCI shortened');const part=Buffer.from(buffer.subarray(0,n));hash.update(part);
  if(onChunk)await onChunk(part);bytes+=n;await yieldTurn();
 }
 assert.equal(readSync(row.fd,buffer,0,1,bytes),0,'staged OCI grew');
 equal(fileCustody(row),before);rootCustody(row);deadline(end);
 assert.equal('sha256:'+hash.digest('hex'),row.archive.digest,'staged OCI readback digest differs');
 return bytes;
}
function dispose(row){
 const errors=[];let absent=false;
 // The held directory anchors deletion after pathname substitution. Refuse an
 // observed replacement; check-then-unlink is not immune to owner/host races.
 try{const before=fileCustody(row);unlinkSync(row.file);const after=fstatSync(row.fd,{bigint:true});
  equal(after,before,['dev','ino','mode','uid','gid','size','mtimeNs']);assert.equal(after.nlink,0n,'original staged inode still linked');
  assert.equal(lstatSync(row.file,{throwIfNoEntry:false}),undefined);fsyncSync(row.root);absent=true;}
 catch(error){errors.push(error);}
 for(const key of ['fd','readFd','root'])if(row[key]!==undefined){try{closeSync(row[key]);}catch(error){errors.push(error);}row[key]=undefined;}
 row.retired=true;
 if(errors.length)throw new AggregateError(errors,'original staged OCI retirement unproven');
 return {original_file_absent:absent,descriptors_closed:true,scope:'owned OCI staging retirement only'};
}

// Not exported through a capability registry: only the closed archive verifier
// may publish the handle. Caller-supplied metadata alone never mints authority.
export function beginConstructionStage(parent,archive,end){
 assert.equal(process.platform,'linux');assert(typeof parent==='string'&&parent.length<4096&&parent!== '/');
 const now=performance.now();assert(Number.isFinite(end)&&end>now&&end-now<=1800000,'bounded original stage deadline required');
 assert(archive&&typeof archive==='object'&&!Array.isArray(archive));
 assert.deepEqual(Object.keys(archive).sort(),['byte_length','digest']);
 const descriptors=Object.getOwnPropertyDescriptors(archive);
 for(const key of ['byte_length','digest'])assert(descriptors[key]&&Object.hasOwn(descriptors[key],'value'),'primitive data-only archive descriptor required');
 // All fallible caller-property work precedes acquisition of owned resources.
 const expected=Object.freeze({byte_length:descriptors.byte_length.value,digest:descriptors.digest.value});
 bounded(expected.byte_length);digest(expected.digest);deadline(end);
 const path=resolve(parent);assert.equal(realpathSync(path),path);
 const directory=lstatSync(path,{bigint:true});
 assert(directory.isDirectory()&&directory.uid===BigInt(process.geteuid())&&(directory.mode&0o7777n)===0o700n,'private caller-owned staging directory required');
 const root=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let row;
 try{
  equal(fstatSync(root,{bigint:true}),directory);
  assert(available(root)>=BigInt(expected.byte_length+reserve),'original OCI bytes plus12GiB staging reserve required');
  const name='.prismpm-oci-'+randomBytes(16).toString('hex'),file='/proc/self/fd/'+root+'/'+name;
  const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  row={path,directory,root,file,fd,archive:expected,written:0};
  row.created=fstatSync(fd,{bigint:true});
  assert(row.created.isFile()&&row.created.nlink===1n&&row.created.size===0n);fileCustody(row);rootCustody(row);
  return {
   async write(part){
    assert(!row.writing&&!row.sealing,'exclusive stage operation required; in-flight operation refused');
    assert(!row.retired&&!row.published&&!row.sealed,'unsealed live stage required');
    assert(Buffer.isBuffer(part)&&part.length>0&&part.length<=1024**2);assert(row.written+part.length<=row.archive.byte_length);
    row.writing=true;
    try{
     // Copy before yielding: the transport cannot mutate an admitted queued view.
     const bytes=Buffer.from(part);
     for(let at=0;at<bytes.length;){deadline(end);fileCustody(row);const n=writeSync(fd,bytes,at,Math.min(65536,bytes.length-at),row.written);
      assert(n>0);at+=n;row.written+=n;await yieldTurn();}
    }finally{row.writing=false;}
   },
   async seal(integrity){
    assert(!row.writing&&!row.sealing,'exclusive stage operation required; in-flight operation refused');
    assert(!row.retired&&!row.published&&!row.sealed,'stage publication is single-use');
    assert.deepEqual(constructionIntegrityArchive(integrity),row.archive,'original verified archive authority differs');
    row.sealing=true;
    try{
     assert.equal(row.written,row.archive.byte_length);deadline(end);fileCustody(row);fsyncSync(fd);fchmodSync(fd,0o400);
     row.sealed=fstatSync(fd,{bigint:true});assert.equal(row.sealed.size,BigInt(row.archive.byte_length));assert.equal(row.sealed.mode&0o7777n,0o400n);
     // chmod does not revoke the writer's existing access mode. Own the new
     // read-only descriptor before any fallible identity check, then retire
     // the original writer before publishing or digesting sealed custody.
     row.readFd=openSync(row.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
     equal(fstatSync(row.readFd,{bigint:true}),row.sealed);rootCustody(row);fileCustody(row);
     closeSync(row.fd);row.fd=row.readFd;row.readFd=undefined;
     await hashFile(row,end);assert(available(root)>=BigInt(reserve),'12GiB staging reserve lost');
     rootCustody(row);fileCustody(row);deadline(end);
     const handle=Object.freeze({});stages.set(handle,row);row.published=true;return handle;
    }finally{row.sealing=false;}
   },
   retire(){assert(!row.writing&&!row.sealing,'exclusive stage operation required; in-flight operation refused');assert(!row.retired&&!row.published,'unpublished live stage required');return dispose(row);}
  };
 }catch(error){
  try{if(row)dispose(row);else closeSync(root);}catch(cleanup){throw new AggregateError([error,cleanup],'stage admission and cleanup failed');}throw error;
 }
}

export function constructionStageDescriptor(handle){const row=owned(handle);return Object.freeze({...row.archive,scope:'verified original OCI tar custody only'});}
export async function consumeConstructionStage(handle,onChunk,timeout=1800000){
 assert(typeof onChunk==='function');assert(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=1800000);
 const row=owned(handle);row.active=true;
 const end=performance.now()+timeout;
 const consume=part=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('staged OCI consumer deadline exceeded')),Math.max(1,end-performance.now()));
  try{Promise.resolve(onChunk(part)).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});}
  catch(error){clearTimeout(timer);reject(error);}
 });
 try{return {byte_length:await hashFile(row,end,consume),digest:row.archive.digest,
  scope:'original staged OCI readback only; no registry/import/SDK acceptance'};}
 finally{row.active=false;}
}
export function retireConstructionStage(handle){const row=stages.get(handle);assert(row&&!row.active&&!row.retired,'live inactive stage required');return dispose(row);}
