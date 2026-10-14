import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import {linkSync,mkdtempSync, writeFileSync, rmSync, symlinkSync,unlinkSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {verifiedCommands} from './metadata-cli.mjs';
import {fixture,encode} from './metadata-test-fixture.mjs';
import {sha} from './metadata-layer.mjs';

test('actual CLI acquires both bounded metadata graphs through HTTP without Docker or ordinary-layer reads', async t => {
  const f = fixture(t), requests = [];
  const directory = mkdtempSync(join(tmpdir(),'metadata-cli-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const inventory = join(directory,'commands.json');
  writeFileSync(inventory,encode({schema:'prismpm/sdk-inventory/1',commands:[]}));
  const authorization = 'Basic ' + Buffer.from('fixture:synthetic-private-token').toString('base64');
  const server = createServer((req,res) => {
    requests.push(req.url);
    assert(!req.url.includes('synthetic-private-token'));
    if (req.headers.authorization !== authorization) {
      res.writeHead(401,{'www-authenticate':'Basic realm="SDK test registry"'}); res.end(); return;
    }
    const selected = /^\/v2\/test-sdk\/(manifests|blobs)\/(sha256:[0-9a-f]{64})$/.exec(req.url);
    assert(selected); assert(!f.lowerDigests.includes(selected[2]), 'must never fetch an ordinary SDK layer');
    const bytes = f.blobs.get(selected[2]); assert(bytes);
    res.writeHead(200,{'content-length':bytes.length}); res.end(bytes);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  const authority = '127.0.0.1:' + server.address().port;
  const reference = authority + '/test-sdk@' + sha(f.index);
  writeFileSync(join(directory,'config.json'), JSON.stringify({auths:{[authority]:{auth:authorization.slice(6)}}}), {mode:0o600});
  const args = [fileURLToPath(new URL('./metadata-cli.mjs',import.meta.url)),reference,sha(f.standards),inventory];
  const env = {...process.env,DOCKER_CONFIG:directory};
  const result = await promisify(execFile)(process.execPath,args,{env,timeout:10000,maxBuffer:1024*1024});
  const lock = JSON.parse(result.stdout);
  assert.equal(lock.schema,'prismpm/sdk-lock/2'); assert.equal(lock.sdk_image,reference);
  assert.equal(lock.sdk_index,f.index.toString()); assert.equal(lock.standards_lock,sha(f.standards));
  assert.equal(requests.length,14); assert.equal(result.stderr,'');
  assert(!result.stdout.includes('synthetic-private-token'));
  for (const row of lock.platforms) assert.equal(row.inventory_document,f.inventories.get(row.platform.split('/')[1]).toString());
  const compatibility = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./platform-lock.mjs',import.meta.url)),'capture',reference,sha(f.standards)],
    {env,timeout:10000,maxBuffer:1024*1024});
  assert.deepEqual(JSON.parse(compatibility.stdout),lock);
  assert.equal(requests.length,28);
  args[2] = sha('wrong standards');
  await assert.rejects(promisify(execFile)(process.execPath,args,{env,timeout:10000,maxBuffer:1024*1024}), error =>
    error.code === 1 && error.stdout === '' && !error.stderr.includes('synthetic-private-token'));
});

test('CLI command custody refuses aliased, noncanonical, duplicate-key and oversized inventories', t => {
  const directory = mkdtempSync(join(tmpdir(),'metadata-command-custody-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const path = join(directory,'commands.json');
  for (const bytes of ['{}','{"schema":"prismpm/sdk-inventory/1","commands":[],"commands":[]}',
    ' '.repeat(8*1024*1024+1)]) {
    writeFileSync(path,bytes); assert.throws(() => verifiedCommands(path));
  }
  writeFileSync(path,encode({schema:'prismpm/sdk-inventory/1',commands:[]}));
  assert.deepEqual(verifiedCommands(path),[]);
  const alias = join(directory,'alias'); symlinkSync(path,alias);
  assert.throws(() => verifiedCommands(alias));
  const peer=join(directory,'hardlink');linkSync(path,peer);
  assert.throws(()=>verifiedCommands(path),/single-link/);unlinkSync(peer);
  assert.deepEqual(verifiedCommands(path),[]);
});

test('command custody rejects actual parent replacement while retaining the unchanged open inode', () => {
  const source=`import assert from 'node:assert/strict';
    import {createRequire,syncBuiltinESMExports} from 'node:module';
    import {mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
    import {tmpdir} from 'node:os';import {join} from 'node:path';
    import {verifiedCommands} from ${JSON.stringify(new URL('./metadata-cli.mjs',import.meta.url).href)};
    const root=mkdtempSync(join(tmpdir(),'metadata-held-name-')),directory=join(root,'owned');mkdirSync(directory);
    const path=join(directory,'commands.json'),saved=join(root,'retained-original');
    writeFileSync(path,'{"commands":[],"schema":"prismpm/sdk-inventory/1"}');
    const bytes=readFileSync(path);assert.deepEqual(verifiedCommands(path),[]);
    const fs=createRequire(import.meta.url)('node:fs'),original=fs.readSync;let replaced=false;
    try {
      fs.readSync=(...args)=>{const count=original(...args);if(!replaced){
        replaced=true;renameSync(directory,saved);mkdirSync(directory);writeFileSync(path,bytes);
      }return count;};syncBuiltinESMExports();
      assert.throws(()=>verifiedCommands(path),/descriptor or name changed/);assert(replaced);
    } finally {fs.readSync=original;syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
    console.log('PASS actual unchanged-descriptor parent replacement refused');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],
    {encoding:'utf8',timeout:10000,maxBuffer:1048576});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);
  assert.equal(child.status,0,child.stdout+child.stderr);
  assert.equal(child.stdout,'PASS actual unchanged-descriptor parent replacement refused\n');
});
