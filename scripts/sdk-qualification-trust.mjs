// Explicit invocation-local trust only; never disables TLS or changes SDK bytes.
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {constants,openSync,readSync,closeSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function qualificationCa(path){
 assert(typeof path==='string'&&path.startsWith('/')&&!/[\r\n,]/.test(path));
 assert.equal(resolve(path),path);assert.equal(realpathSync(path),path,'unaliased explicit qualification CA required');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd,{bigint:true});assert(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=65536n);
  assert.equal(before.mode&0o222n,0n,'read-only original qualification CA required');
  const bytes=Buffer.alloc(Number(before.size));let offset=0;
  while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);assert(n>0);offset+=n;}
  assert.equal(readSync(fd,Buffer.alloc(1),0,1,null),0);
  for(const after of[fstatSync(fd,{bigint:true}),lstatSync(path,{bigint:true})])
   for(const key of['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key]);
  assert.equal(realpathSync(path),path);
  assert.match(bytes.toString('ascii'),/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n?$/);
  const cert=new X509Certificate(bytes);assert(cert.ca&&cert.subject===cert.issuer&&cert.verify(cert.publicKey));
  return {path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes};
 }finally{closeSync(fd);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 assert.equal(process.argv.length,3);const row=qualificationCa(process.argv[2]);
 console.log(JSON.stringify({path:row.path,sha256:row.sha256,scope:'explicit invocation-local TLS trust only'}));
}
