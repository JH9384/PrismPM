// Real bounded CA/file boundary units only, never private-registry acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {chmodSync,linkSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {qualificationCa} from './sdk-qualification-trust.mjs';
test('explicit read-only single-link self-issued CA retains exact bytes and digest',()=>{
 const root=mkdtempSync(join(tmpdir(),'qualification-ca-unit-'));
 try{
  const path=join(root,'ca.crt');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-sha256','-subj','/CN=unit-only-owned-ca','-addext','basicConstraints=critical,CA:TRUE','-keyout',join(root,'ca.key'),'-out',path],{timeout:20000,maxBuffer:65536,stdio:['ignore','ignore','pipe']});
  chmodSync(path,0o444);const result=qualificationCa(path);assert.equal(result.path,path);assert(result.bytes.equals(readFileSync(path)));assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert(!Object.hasOwn(result,'accepted'));
 }finally{rmSync(root,{recursive:true});}
});
test('aliases, hardlinks, writable, oversized, missing and non-certificate CA files refuse',()=>{
 const root=mkdtempSync(join(tmpdir(),'qualification-ca-refusal-unit-'));
 try{
  const path=join(root,'ca.crt');writeFileSync(path,'unit-only malformed certificate');chmodSync(path,0o444);
  symlinkSync(path,join(root,'alias'));linkSync(path,join(root,'hardlink'));
  for(const p of[path,join(root,'alias'),join(root,'hardlink'),join(root,'missing'),root,'relative-ca'])assert.throws(()=>qualificationCa(p));
  const writable=join(root,'writable');writeFileSync(writable,'unit');assert.throws(()=>qualificationCa(writable));
  const large=join(root,'large');writeFileSync(large,Buffer.alloc(65537));chmodSync(large,0o444);assert.throws(()=>qualificationCa(large));
 }finally{rmSync(root,{recursive:true});}
});
