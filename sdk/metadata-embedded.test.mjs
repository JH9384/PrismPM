// Actual isolated helper execution and Cargo listing, not SDK release acceptance.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {fixture,encode} from './metadata-test-fixture.mjs';
import {sha} from './metadata-layer.mjs';

test('actual embedded metadata helper and Cargo package preserve the complete public runtime closure',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'metadata-embedded-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const rust=readFileSync(new URL('../crates/prismpm/src/sdk.rs',import.meta.url),'utf8');
  const start=rust.indexOf('let helper = directory.path().join("metadata-cli.mjs");');
  assert(start>=0);const end=rust.indexOf('let node = executable("node")?;',start);assert(end>start);
  const rows=[...rust.slice(start,end).matchAll(/"([a-z0-9.-]+)",\s*include_bytes!\("\.\.\/sdk\/([a-z0-9.-]+)"\)/g)];
  assert.equal(rows.length,8);assert.equal(new Set(rows.map(row=>row[1])).size,8);
  for(const row of rows){assert.equal(row[1],row[2]);writeFileSync(join(directory,row[1]),readFileSync(new URL('./'+row[2],import.meta.url)));}
  const root=fileURLToPath(new URL('..',import.meta.url));
  const listed=await promisify(execFile)('cargo',['package','--list','--locked','--offline','--allow-dirty',
    '--manifest-path','crates/prismpm/Cargo.toml','--target-dir',join(directory,'cargo-target')],
    {cwd:root,timeout:30000,maxBuffer:1024*1024});
  const paths=new Set(listed.stdout.trim().split('\n'));
  for(const row of rows)assert(paths.has('sdk/'+row[1]),'embedded dependency missing from actual Cargo package: '+row[1]);
  const f=fixture(t),requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.url);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,undefined);
    const match=/^\/v2\/test-sdk\/(manifests|blobs)\/(sha256:[a-f0-9]{64})$/.exec(req.url);assert(match);
    assert(!f.lowerDigests.includes(match[2]));const bytes=f.blobs.get(match[2]);assert(bytes);
    res.writeHead(200,{'content-length':bytes.length});res.end(bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  writeFileSync(join(directory,'commands.json'),encode({schema:'prismpm/sdk-inventory/1',commands:[]}));
  writeFileSync(join(directory,'config.json'),'{}',{mode:0o600});
  const reference='127.0.0.1:'+server.address().port+'/test-sdk@'+sha(f.index);
  const args=[join(directory,'metadata-cli.mjs'),reference,sha(f.standards),join(directory,'commands.json')];
  const options={cwd:directory,env:{...process.env,DOCKER_CONFIG:directory},timeout:10000,maxBuffer:1024*1024};
  const result=await promisify(execFile)(process.execPath,args,options);
  assert.equal(result.stderr,'');const lock=JSON.parse(result.stdout);
  assert.equal(lock.sdk_image,reference);assert.equal(lock.sdk_index,f.index.toString());assert.equal(requests.length,7);
  for(const row of lock.platforms)assert.equal(row.inventory_document,f.inventories.get(row.platform.split('/')[1]).toString());
  // Removing an actual embedded runtime dependency must fail before acquisition.
  rmSync(join(directory,'metadata-layer.mjs'));
  await assert.rejects(promisify(execFile)(process.execPath,args,options),error=>error.code===1&&error.stdout==='');
  assert.equal(requests.length,7,'missing dependency must not perform a partial acquisition');
});
