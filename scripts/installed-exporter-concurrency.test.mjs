// Adversarial parser and actual process/descriptor controls, not SDK execution.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,chmodSync,renameSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {installedEnvironment,observeOwners,startOwnedCommand,verifyCustody,verifyTemporaryRetirement} from './installed-exporter-concurrency.mjs';
import {verifyResult} from './library-sdk-check.mjs';
import {lockFixture,custodyFixture,resultFixture,sourceAuthorityFixture} from './library-sdk-fixture.mjs';
const temporary=t=>{const root=mkdtempSync(join(tmpdir(),'prismpm-concurrency-control-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};

test('original installed custody readback refuses resealed bytes, identities and namespace omissions',()=>{
 const fixture=lockFixture(),binding=fixture.binding('amd64'),record=custodyFixture(binding),identity={compiler_revision:binding.compiler_revision,
  archive_sha256:sourceAuthorityFixture.archive_sha256,toolchain:sourceAuthorityFixture.toolchain,platform:binding.platform};
 verifyCustody(record,binding,identity);
 const mutate=(change)=>{const bad=structuredClone(record),rows=JSON.parse(bad.document);change(rows);bad.document=fixture.encode(rows);bad.sha256=fixture.hash(bad.document);return bad;};
 for(const change of [rows=>rows.pop(),rows=>rows.reverse(),rows=>rows.push(rows[0]),rows=>rows[0].uid='1000',
  rows=>rows[0].mode=String(0o40777),rows=>rows.find(row=>row.kind==='file').nlink='2',
  rows=>rows.find(row=>row.kind==='file').sha256='a'.repeat(64),rows=>rows[0].ino='-1',rows=>rows[0].extra=true,
  rows=>rows.find(row=>row.path==='/lib').target='/tmp/foreign',rows=>rows.find(row=>row.path.endsWith('/prod-export')).size='1'])
  assert.throws(()=>verifyCustody(mutate(change),binding,identity));
 for(const which of ['before','after']){
  const value=resultFixture(binding),rows=JSON.parse(value.concurrency.custody[which].document);
  rows.find(row=>row.path.endsWith('/prod-export')).ino='9999';
  value.concurrency.custody[which].document=fixture.encode(rows);value.concurrency.custody[which].sha256=fixture.hash(value.concurrency.custody[which].document);
  assert.throws(()=>verifyResult(value,binding,sourceAuthorityFixture),'same bytes do not replace original native custody');
 }
 for(const change of [value=>value.tools.pop(),value=>value.tools.reverse(),value=>value.tools[0].sha256='a'.repeat(64),
  value=>value.tools[1].selected='/tmp/node',value=>value.tools[2].canonical_path='/tmp/python3',
  value=>value.tools[3].sha256='b'.repeat(64),value=>value.inventory_document+=' ',value=>value.tools[0].mode=0o644]){
  const bad=structuredClone(record);change(bad);assert.throws(()=>verifyCustody(bad,binding,identity));
 }
 const poisoned=resultFixture(binding);poisoned.concurrency.environments[0].PYTHONPATH='/tmp/foreign';
 assert.throws(()=>verifyResult(poisoned,binding,sourceAuthorityFixture));
});

test('two original no-follow descriptors observe distinct live exporter owners and reject unsafe namespaces',t=>{
 const root=temporary(t),roots=[join(root,'a'),join(root,'b')];for(const path of roots)mkdirSync(path,{mode:0o700});
 assert.equal(observeOwners(roots),null);
 const owners=roots.map(path=>join(path,'prismpm-verify-exporter-ABCDEF'));
 for(const path of owners){mkdirSync(path,{mode:0o700});mkdirSync(join(path,'lean4-prod'),{mode:0o700});}
 const observed=observeOwners(roots);assert.equal(observed.length,2);
 for(const [index,row] of observed.entries()){const stat=lstatSync(owners[index],{bigint:true});assert.equal(row.dev,String(stat.dev));assert.equal(row.ino,String(stat.ino));assert.equal(row.path,owners[index]);}
 assert.notEqual(observed[0].ino,observed[1].ino);
 chmodSync(owners[0],0o755);assert.throws(()=>observeOwners(roots));chmodSync(owners[0],0o700);
 const extra=join(roots[0],'prismpm-verify-exporter-GHIJKL');mkdirSync(extra,{mode:0o700});assert.throws(()=>observeOwners(roots));rmSync(extra,{recursive:true});
 rmSync(owners[0],{recursive:true});symlinkSync(owners[1],owners[0]);assert.throws(()=>observeOwners(roots));
 const retired=join(root,'retired');mkdirSync(retired,{mode:0o700});
 const original={path:retired,stat:lstatSync(retired,{bigint:true}),fd:openSync(retired,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)};
 try{
  const receipt=join(retired,'process-owner.json');writeFileSync(receipt,'fixture only');verifyTemporaryRetirement(original);
  for(const mode of [0o755,0o666]){chmodSync(receipt,mode);assert.throws(()=>verifyTemporaryRetirement(original));}chmodSync(receipt,0o600);
  writeFileSync(receipt,'');assert.throws(()=>verifyTemporaryRetirement(original));writeFileSync(receipt,'x'.repeat(65537));assert.throws(()=>verifyTemporaryRetirement(original));writeFileSync(receipt,'fixture only');
  writeFileSync(join(retired,'foreign-cache'),'unexpected');assert.throws(()=>verifyTemporaryRetirement(original));rmSync(join(retired,'foreign-cache'));
  linkSync(receipt,join(root,'receipt-link'));assert.throws(()=>verifyTemporaryRetirement(original));rmSync(join(root,'receipt-link'));
  rmSync(receipt);symlinkSync('/etc/hosts',receipt);assert.throws(()=>verifyTemporaryRetirement(original));rmSync(receipt);writeFileSync(receipt,'fixture only');
  renameSync(retired,retired+'-original');mkdirSync(retired,{mode:0o700});writeFileSync(receipt,'replacement');assert.throws(()=>verifyTemporaryRetirement(original));
 }finally{closeSync(original.fd);}
});

test('actual subreaper retires a detached child after its command exits and preserves original UTF-8 output',async t=>{
 const root=temporary(t),receipt=join(root,'retirement.json');
 const program='import subprocess,sys,time\np=subprocess.Popen(["/usr/bin/python3","-c","import time; time.sleep(60)"],start_new_session=True)\nprint(p.pid,flush=True)\nb="\u03bb".encode();sys.stdout.buffer.write(b[:1]);sys.stdout.buffer.flush();time.sleep(.01);sys.stdout.buffer.write(b[1:]);sys.stdout.buffer.flush()';
 const result=await startOwnedCommand(['/usr/bin/python3','-c',program],root,receipt,5).done;
 assert.equal(result.output.status,0);assert.match(result.output.stdout,/^[1-9][0-9]*\n\u03bb$/);
 const pid=Number(result.output.stdout.split('\n')[0]);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 assert.deepEqual(result.retirement,{schema:'prismpm/portable-process-owner/1',exit_code:0,timed_out:false,interrupted:false,cleanup_verified:true});
 const poison={PYTHONPATH:'/tmp/foreign',LD_PRELOAD:'/tmp/foreign.so',CARGO_HOME:'/tmp/foreign-cargo',CARGO_TARGET_DIR:'/tmp/foreign-target',HOME:'/tmp/foreign-home',PATH:'/tmp/foreign-bin',XDG_CONFIG_HOME:'/tmp/foreign-config',ELAN_TOOLCHAIN:'foreign',RUSTUP_TOOLCHAIN:'foreign'};
 const original=new Map(Object.keys(poison).map(name=>[name,process.env[name]]));
 try{
  Object.assign(process.env,poison);
  const isolated=await startOwnedCommand(['/usr/bin/python3','-c','import json,os; print(json.dumps(dict(os.environ)))'],root,join(root,'isolated.json'),5).done;
  const actual=JSON.parse(isolated.output.stdout);delete actual.LC_CTYPE; // CPython locale coercion only.
  assert.deepEqual(actual,installedEnvironment(root));assert.deepEqual(isolated.environment,installedEnvironment(root));
 }finally{for(const [name,value] of original)if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

test('actual command failure, deadline and excessive output never become successful paired acceptance',async t=>{
 const root=temporary(t),exit=await startOwnedCommand(['/usr/bin/python3','-c','import sys; sys.exit(17)'],root,join(root,'exit.json'),5).done;
 assert.equal(exit.output.status,17);assert.equal(exit.retirement.exit_code,17);
 const deadline=startOwnedCommand(['/usr/bin/python3','-c','import time; time.sleep(60)'],root,join(root,'deadline.json'),0.2);
 await assert.rejects(deadline.done);const timed=JSON.parse(readFileSync(join(root,'deadline.json')));assert.equal(timed.cleanup_verified,true);assert(timed.timed_out||timed.interrupted);
 const overflow=startOwnedCommand(['/usr/bin/python3','-c','import os,time\nwhile True: os.write(1,b"x"*65536)'],root,join(root,'overflow.json'),5);
 await assert.rejects(overflow.done);const excessive=JSON.parse(readFileSync(join(root,'overflow.json')));assert.equal(excessive.cleanup_verified,true);assert.equal(excessive.interrupted,true);
});
