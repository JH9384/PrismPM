// Synthetic graph controls, never installed SDK or native materialization acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './metadata-test-fixture.mjs';
import {sha} from './metadata-layer.mjs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

test('metadata graph custody retains seven original objects and joins both native inventories',async t=>{
  const {captureMetadataEvidence,verifyMetadataEvidence,joinNativeMetadata}=await import('./metadata-evidence.mjs');
  const f=fixture(t),captured=await captureMetadataEvidence(f.reference,sha(f.standards),f.transport);
  const bytes=Buffer.from(canonical(captured.lock));
  assert.equal(f.calls.length,7);
  assert.equal(captured.evidence.objects.length,7);
  for(const row of captured.evidence.objects) assert(Buffer.from(row.base64,'base64').equals(f.blobs.get(row.reference.split('@')[1])));
  await verifyMetadataEvidence(captured.evidence,bytes);
  const rows=['amd64','arm64'].map(architecture=>({platform:'linux/'+architecture,
    sdk_image:f.reference,source_revision:'a'.repeat(40),
    inventory_document:f.inventories.get(architecture).toString(),standards_base64:f.standards.toString('base64')}));
  const joined=await joinNativeMetadata(captured.evidence,bytes,rows,'a'.repeat(40));
  assert.equal(joined.scope,'metadata-native-byte-equivalence-only');
  assert.deepEqual(joined.platforms.map(row=>row.platform),['linux/amd64','linux/arm64']);
  for(const mutate of [v=>v.pop(),v=>v.reverse(),v=>v[1].platform='linux/amd64',
    v=>v[1].inventory_document=v[0].inventory_document,v=>v[1].standards_base64=Buffer.from('different').toString('base64'),
    v=>v[0].sdk_image+='0',v=>v[0].source_revision='b'.repeat(40),v=>v[0].extra=true]) {
    const changed=structuredClone(rows);mutate(changed);
    await assert.rejects(joinNativeMetadata(captured.evidence,bytes,changed,'a'.repeat(40)));
  }
});

test('metadata custody rejects omitted substituted oversized and coherently rehashed records',async t=>{
  const {captureMetadataEvidence,verifyMetadataEvidence}=await import('./metadata-evidence.mjs');
  const f=fixture(t),captured=await captureMetadataEvidence(f.reference,sha(f.standards),f.transport);
  const bytes=Buffer.from(canonical(captured.lock));
  for(const mutate of [v=>v.objects.pop(),v=>v.objects.reverse(),v=>v.objects.push(v.objects[0]),
    v=>v.objects[2].base64+='=',v=>v.objects[2].byte_length++,v=>v.objects[2].maximum++,
    v=>v.objects[2].reference+='0',v=>v.objects[2].kind='manifest',
    v=>v.objects[2].base64=Buffer.from('changed').toString('base64'),
    v=>{v.objects[2].base64=Buffer.from('changed').toString('base64');v.objects[2].byte_length=7;v.objects[2].digest=sha('changed');},
    v=>v.objects[2].ended_ms=180002,v=>v.objects[2].timeout_ms=45001,v=>v.objects[2].timeout_ms=1,v=>v.objects[2].started_ms=-1,
    v=>v.scope='installed-SDK-acceptance',v=>v.extra=true,v=>v.lock_digest=sha('changed')]) {
    const changed=structuredClone(captured.evidence);mutate(changed);
    await assert.rejects(verifyMetadataEvidence(changed,bytes));
  }
  await assert.rejects(verifyMetadataEvidence(captured.evidence,Buffer.concat([bytes,Buffer.from('\n')])));
});

test('metadata custody cannot publish overflow failed or changed graph acquisition',async t=>{
  const {captureMetadataEvidence}=await import('./metadata-evidence.mjs');
  for(const fault of ['overflow','failure','changed','not-bytes']) {
    const f=fixture(t);let calls=0;
    await assert.rejects(captureMetadataEvidence(f.reference,sha(f.standards),async request=>{
      calls++;
      if(fault==='overflow')return Buffer.alloc(request.maximum+1);
      if(fault==='failure')throw Error('actual transport refusal control');
      if(fault==='not-bytes')return '{}';
      return Buffer.concat([await f.transport(request),Buffer.from('changed')]);
    }));
    assert.equal(calls,1,'no retry image pull or acceptance fallback');
  }
});

test('SDK-owned HTTP acquisition retains exact original metadata bytes without credentials or lower layers',async t=>{
  const {captureSdkMetadataEvidence}=await import('./metadata-evidence-cli.mjs');
  const {verifyMetadataEvidence}=await import('./metadata-evidence.mjs');
  const f=fixture(t),requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.url);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,undefined);
    const match=/^\/v2\/test-sdk\/(manifests|blobs)\/(sha256:[a-f0-9]{64})$/.exec(req.url);
    assert(match);assert(!f.lowerDigests.includes(match[2]));
    const bytes=f.blobs.get(match[2]);assert(bytes);
    res.writeHead(200,{'content-length':bytes.length});res.end(bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const reference='127.0.0.1:'+server.address().port+'/test-sdk@'+sha(f.index);
  const captured=await captureSdkMetadataEvidence(reference,sha(f.standards),[]);
  assert.equal(requests.length,7);assert.equal(captured.evidence.objects.length,7);
  await verifyMetadataEvidence(captured.evidence,Buffer.from(canonical(captured.lock)));
  assert.equal(requests.length,7,'replay must be offline');
});

test('private native evidence survives two-lane roundtrip and refuses missing changed aliased or swapped records',async t=>{
  const {capture,validateAcquisitionBytes}=await import('../scripts/library-sdk-check.mjs');
  // The exact bound reaches JSON validation; the next byte must fail before
  // decoding/allocation. These are reader bounds, not usable SDK evidence.
  const maximum=288*1024*1024,oversized=Buffer.alloc(maximum+1);
  assert.throws(()=>validateAcquisitionBytes(oversized),/bounded original acquisition/);
  assert.throws(()=>validateAcquisitionBytes(oversized.subarray(0,maximum)),SyntaxError);
  const {captureLane,writeLane,readLane,joinLanes,packLane}=await import('../scripts/library-sdk-metadata-evidence.mjs');
  const {lockFixture,qualificationFixture,resultFixture}=await import('../scripts/library-sdk-fixture.mjs');
  const {historicalLock,migrationChecks,expectedMigrationProcesses}=await import('./migration-qualification.mjs');
  const source=resolve(dirname(fileURLToPath(import.meta.url)),'..'),revision='a'.repeat(40);
  const work=mkdtempSync(join(tmpdir(),'native-metadata-roundtrip-'));t.after(()=>rmSync(work,{recursive:true,force:true}));
  const root=join(work,'source');mkdirSync(root);
  const original=capture(source,revision);
  for(const row of original.files) {
    const path=join(root,row.path);mkdirSync(dirname(path),{recursive:true});
    if(row.kind==='directory')mkdirSync(path,{recursive:true});
    else if(row.kind==='symlink')symlinkSync(row.target,path);
    else copyFileSync(join(source,row.path),path);
  }
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const authority={archive_sha256:hash(readFileSync(join(root,'vendor/lean4-prod/lean.tar'))),
    toolchain:readFileSync(join(root,'lean-toolchain'),'utf8').trim()};
  const sdk=lockFixture(authority,readFileSync(join(root,'standards.lock'))),metadata=await sdk.metadataEvidence();
  const historical=historicalLock(),directories=[];
  for(const architecture of ['amd64','arm64']) {
    const directory=join(work,architecture);mkdirSync(directory);
    const binding=sdk.binding(architecture),context={sdk_image:sdk.image,source_revision:revision,architecture};
    const migration={schema:'prismpm/installed-lock-migration/2',historical_source:historical.authority,
      platform:'linux/'+architecture,historical_sha256:historical.source.sha256,target_sha256:hash(sdk.bytes),checks:migrationChecks,
      processes:expectedMigrationProcesses(sdk.lock,'linux/'+architecture).map(row=>({...row,stdout_sha256:'1'.repeat(64),stderr_sha256:'2'.repeat(64)})),
      proposal:{schema:'prismpm/sdk-lock-migration/1',compatibility_review:'required',generated_output_diff:'required',security_review:'required',
        patch:[{op:'test',path:'',value:JSON.parse(historical.document)},{op:'replace',path:'',value:sdk.lock}]}};
    const values={'source.json':original,'image.json':[{Os:'linux',Architecture:architecture,RepoDigests:[sdk.image],
      Config:{Entrypoint:['/usr/local/bin/prismpm-devcontainer-init'],Volumes:null,Labels:{
        'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM',
        'org.opencontainers.image.version':'0.3.0'}}}],
      'acquisition.json':{lock:sdk.lock,metadata,migration},'compiler.json':qualificationFixture(binding,authority),
      'custody.json':{scope:'filesystem-custody-only',checks:6,status:'passed'},'result.json':resultFixture(binding,authority)};
    for(const [name,value] of Object.entries(values))writeFileSync(join(directory,name),name==='acquisition.json'?canonical(value):JSON.stringify(value));
    writeFileSync(join(directory,'inventory.json'),sdk.lock.platforms.find(row=>row.platform===binding.platform).inventory_document);
    writeFileSync(join(directory,'standards.lock'),sdk.standards);
    const acquisitionPath=join(directory,'acquisition.json'),raw=readFileSync(acquisitionPath);
    for(const changed of [
      Buffer.from('{"lock":{},'+raw.toString().slice(1)),
      Buffer.from('{"\\u006cock":{},'+raw.toString().slice(1)),
      Buffer.from(raw.toString().replace('"schema":"prismpm/sdk-lock/2"','"schema":"ignored","schema":"prismpm/sdk-lock/2"')),
      Buffer.from(raw.toString().replace('"schema":"prismpm/sdk-lock/2"','"schema":"ignored","\\u0073chema":"prismpm/sdk-lock/2"')),
      Buffer.from([0xff]),
      Buffer.from(canonical({...values['acquisition.json'],extra:true})),
      Buffer.from(JSON.stringify(values['acquisition.json'],null,2)),
      Buffer.concat([raw,Buffer.from('\n')]),
    ]) {
      await captureLane(directory,root,context);
      writeFileSync(acquisitionPath,changed);
      await assert.rejects(captureLane(directory,root,context));
      writeFileSync(acquisitionPath,raw);
    }
    const output=join(root,'target/library-sdk-evidence/linux-'+architecture);
    await writeLane(directory,output,root,context);await readLane(output,root,context);
    await assert.rejects(writeLane(directory,output,root,context));
    const archive=join(work,architecture+'.tar'),repeat=join(work,architecture+'-repeat.tar');
    await packLane(output,archive,root,context);await packLane(output,repeat,root,context);
    assert(readFileSync(archive).equals(readFileSync(repeat)));await assert.rejects(packLane(output,archive,root,context));
    directories.push(output);
  }
  const joined=await joinLanes(directories,root,sdk.image,revision);
  assert.equal(joined.join.scope,'metadata-native-byte-equivalence-only');assert.equal(joined.lane_evidence.length,2);
  await assert.rejects(joinLanes(directories.slice().reverse(),root,sdk.image,revision));
  const second=directories[1],context={sdk_image:sdk.image,source_revision:revision,architecture:'arm64'};
  for(const name of ['inventory.json','evidence.json','acquisition.json']) {
    const path=join(second,name),bytes=readFileSync(path);rmSync(path);
    await assert.rejects(readLane(second,root,context));
    symlinkSync(join(directories[0],name),path);await assert.rejects(readLane(second,root,context));rmSync(path);
    writeFileSync(path,Buffer.concat([bytes,Buffer.from('changed')]));await assert.rejects(readLane(second,root,context));
    writeFileSync(path,bytes);await readLane(second,root,context);
  }
  writeFileSync(join(second,'extra'),'extra');await assert.rejects(readLane(second,root,context));rmSync(join(second,'extra'));
  assert.equal(readdirSync(second).length,9);assert(existsSync(join(second,'evidence.json')));
  await joinLanes(directories,root,sdk.image,revision);
});
