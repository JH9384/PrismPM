// Installed migration qualification; fixture provenance is historical, not SDK admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fields=(value,expected)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),expected.slice().sort());
};
const gitObject=(kind,bytes)=>createHash('sha1').update(Buffer.concat([
  Buffer.from(`${kind} ${bytes.length}\0`),bytes])).digest('hex');
export function verifyHistoricalSource(document,bytes=readFileSync(new URL('./fixtures/hologram-live-historical-source.json',import.meta.url))) {
  assert.equal(typeof document,'string'); assert(Buffer.byteLength(document)<=128*1024);
  assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024);
  const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  assert.equal(bytes.toString(),canonical(source)+'\n');
  fields(source,['schema','repository','revision','path','commit','tree','document_sha256','blob_oid']);
  assert.equal(source.schema,'prismpm/historical-lock-git-source/1');
  assert.equal(source.repository,'https://github.com/Hologram-Technologies/hologram-live');
  assert.equal(source.revision,'419759164f6cfae768fd5536da5cd8422efbf032');
  assert.equal(source.path,'prismpm.lock');
  const object=(kind,row,oid,sha256)=>{
    fields(row,['git_oid','sha256','base64']);
    assert.equal(row.git_oid,oid); assert.equal(row.sha256,sha256);
    assert.equal(typeof row.base64,'string'); assert(row.base64.length>0&&row.base64.length<=64*1024);
    const decoded=Buffer.from(row.base64,'base64'); assert.equal(decoded.toString('base64'),row.base64);
    assert.equal(hash(decoded),sha256); assert.equal(gitObject(kind,decoded),oid); return decoded;
  };
  const commit=object('commit',source.commit,source.revision,'12f347be78c92f8569c6e03602011374685c84867cfaa2ec74a75ea89c186979');
  const tree=object('tree',source.tree,'71011ce2afb0e3354819d20bea2dd4623b09db90','5b7277fa96431637230a46886e73b3f511bbb70302aff796cbafb4fbe1ed1b27');
  assert.equal(commit.toString('utf8').split('\n')[0],'tree '+source.tree.git_oid);
  const entries=[];
  for(let offset=0;offset<tree.length;) {
    const space=tree.indexOf(32,offset); assert(space>offset&&space-offset<=6);
    const mode=tree.subarray(offset,space).toString('ascii');
    assert(['40000','100644','100755','120000','160000'].includes(mode));
    const end=tree.indexOf(0,space+1); assert(end>space+1&&end-space<=256&&end+21<=tree.length);
    const path=new TextDecoder('utf-8',{fatal:true}).decode(tree.subarray(space+1,end));
    assert(!/[\x00-\x1f/\\]/.test(path)&&!['.','..'].includes(path));
    assert(!entries.some(row=>row.path===path));
    entries.push({mode,path,oid:tree.subarray(end+1,end+21).toString('hex')}); offset=end+21;
  }
  const selected=entries.filter(row=>row.path===source.path); assert.equal(selected.length,1);
  assert.equal(selected[0].mode,'100644');
  assert.equal(source.blob_oid,'cec41c29f6caf8ace4ea2cbf1fb38db3d242bdaa');
  assert.equal(selected[0].oid,source.blob_oid); assert.equal(gitObject('blob',Buffer.from(document)),source.blob_oid);
  assert.equal(source.document_sha256,'5ee081904bacc478e07a0706421c4a09fe02121e0e0c65391ca2395ec1b41bac');
  assert.equal(hash(document),source.document_sha256);
  return {schema:'prismpm/historical-lock-source/1',scope:'historical-input-only-not-target-sdk-acceptance',
    repository:source.repository,revision:source.revision,path:source.path,blob_oid:source.blob_oid,
    commit_sha256:source.commit.sha256,tree_oid:source.tree.git_oid,tree_sha256:source.tree.sha256,
    document_sha256:source.document_sha256,source_document_sha256:hash(bytes)};
}
export function historicalLock() {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hologram-live-historical-lock.json', import.meta.url)));
  return verifyHistoricalFixture(fixture);
}
// Original Git objects are imported data, not caller-produced provenance. The
// real Git oracle proves the pinned commit -> root tree -> exact regular blob
// relation offline. No publisher signature or current-upstream state is claimed.
export function verifyHistoricalFixture(fixture) {
  assert.deepEqual(Object.keys(fixture).sort(), ['document','objects','source']);
  assert.deepEqual(fixture.source, {repository: 'https://github.com/Hologram-Technologies/hologram-live',
    revision: '419759164f6cfae768fd5536da5cd8422efbf032', path: 'prismpm.lock',
    git_blob: 'cec41c29f6caf8ace4ea2cbf1fb38db3d242bdaa',
    sha256: '5ee081904bacc478e07a0706421c4a09fe02121e0e0c65391ca2395ec1b41bac'});
  assert.equal(hash(fixture.document), fixture.source.sha256);
  assert.equal(canonical(JSON.parse(fixture.document)), fixture.document);
  assert.equal(JSON.parse(fixture.document).schema, 'prismpm/sdk-lock/1');
  assert.deepEqual(Object.keys(fixture.objects).sort(), ['commit_base64','tree_base64']);
  const decode = text => {
    assert.equal(typeof text,'string');assert(text.length > 0 && text.length <= 87384);
    const bytes=Buffer.from(text,'base64');assert(bytes.length <= 65536);
    assert.equal(bytes.toString('base64'),text,'canonical original Git object bytes');return bytes;
  };
  const commit=decode(fixture.objects.commit_base64),tree=decode(fixture.objects.tree_base64);
  const treeId=/^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'))?.[1];
  assert(treeId,'original commit root tree is required');
  const work=mkdtempSync('/tmp/prismpm-historical-git-');
  try {
    const git=(args,input) => {
      const p=spawnSync('/usr/bin/git',args,{cwd:work,input,timeout:5000,maxBuffer:65536,
        env:{PATH:'/usr/bin:/bin',HOME:work,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
          GIT_NO_REPLACE_OBJECTS:'1',LANG:'C',LC_ALL:'C'}});
      assert.ifError(p.error);assert.equal(p.signal,null);assert.equal(p.status,0,'original Git oracle refused historical source');
      return p.stdout;
    };
    git(['init','--bare','--quiet','--object-format=sha1']);
    for(const [type,bytes,expected] of [['commit',commit,fixture.source.revision],
      ['tree',tree,treeId],['blob',Buffer.from(fixture.document),fixture.source.git_blob]])
      assert.equal(git(['hash-object','-w','-t',type,'--stdin'],bytes).toString(),expected+'\n','original Git object identity differs');
    assert.equal(git(['ls-tree',fixture.source.revision,'--',fixture.source.path]).toString(),
      '100644 blob '+fixture.source.git_blob+'\t'+fixture.source.path+'\n','historical lock is not the pinned regular Git blob');
    assert(git(['cat-file','blob',fixture.source.revision+':'+fixture.source.path]).equals(Buffer.from(fixture.document)),
      'historical lock bytes differ from the actual pinned commit tree');
  } finally { rmSync(work,{recursive:true}); }
  return {...fixture,authority:verifyHistoricalSource(fixture.document)};
}
export const migrationChecks = Object.freeze(['historical-refusal', 'read-only-proposal', 'exact-root-replay',
  'native-admission', 'changed-native-inventory-refusal', 'swapped-platform-refusal']);
export function inventoryMutants(target, platform) {
  const changed = structuredClone(target), native = changed.platforms.find(row => row.platform === platform);
  assert.notEqual(native.inventory[0].digest, 'sha256:' + '0'.repeat(64));
  native.inventory[0].digest = 'sha256:' + '0'.repeat(64);
  const document = JSON.parse(native.inventory_document); document.artifacts = native.inventory;
  native.inventory_document = canonical(document) + '\n';
  native.inventory_digest = 'sha256:' + hash(native.inventory_document);
  const swapped = structuredClone(target);
  for (const field of ['inventory', 'inventory_document', 'inventory_digest'])
    [swapped.platforms[0][field], swapped.platforms[1][field]] = [swapped.platforms[1][field], swapped.platforms[0][field]];
  assert.notEqual(swapped.platforms[0].inventory_digest, swapped.platforms[1].inventory_digest,
    'foreign native inventory probe must alter native authority');
  return [changed, swapped];
}
export function expectedMigrationProcesses(target, platform) {
  const check = ['lock', 'check'];
  return [
    {argv: check, exit_code: 4, input_sha256: historicalLock().source.sha256},
    {argv: ['lock', 'migrate', '--sdk-image', target.sdk_image, '--standards-lock', target.standards_lock], exit_code: 0, input_sha256: historicalLock().source.sha256},
    {argv: check, exit_code: 0, input_sha256: hash(canonical(target))},
    ...inventoryMutants(target, platform).map(value => ({argv: check, exit_code: 4, input_sha256: hash(canonical(value))})),
  ];
}
export function verifyMigration(value, lockBytes) {
  assert(['prismpm/installed-lock-migration/1','prismpm/installed-lock-migration/2'].includes(value.schema));
  const expectedFields=['checks', 'historical_sha256', 'platform', 'processes', 'proposal', 'schema', 'target_sha256'];
  if(value.schema==='prismpm/installed-lock-migration/2') {
    expectedFields.push('historical_source'); assert.deepEqual(value.historical_source,historicalLock().authority);
  }
  assert.deepEqual(Object.keys(value).sort(),expectedFields.sort());
  assert(['linux/amd64', 'linux/arm64'].includes(value.platform));
  assert.equal(value.historical_sha256, historicalLock().source.sha256);
  assert.equal(value.target_sha256, hash(lockBytes));
  assert.deepEqual(value.checks, migrationChecks);
  const old = JSON.parse(historicalLock().document), target = JSON.parse(lockBytes);
  assert.equal(target.schema, 'prismpm/sdk-lock/2');
  assert.equal(canonical(target), lockBytes.toString());
  assert.deepEqual(value.proposal, {schema: 'prismpm/sdk-lock-migration/1',
    compatibility_review: 'required', generated_output_diff: 'required', security_review: 'required',
    patch: [{op: 'test', path: '', value: old}, {op: 'replace', path: '', value: target}]});
  // Apply only after the original full document passes the ordered test.
  let applied = old;
  for (const operation of value.proposal.patch) {
    assert.equal(operation.path, '');
    if (operation.op === 'test') assert.deepEqual(applied, operation.value);
    else { assert.equal(operation.op, 'replace'); applied = operation.value; }
  }
  assert.equal(canonical(applied), lockBytes.toString());
  assert.equal(value.processes.length, 5);
  const expected = expectedMigrationProcesses(target, value.platform);
  for (const [index, row] of value.processes.entries()) {
    const {stdout_sha256, stderr_sha256, ...identity} = row;
    assert.match(stdout_sha256, /^[a-f0-9]{64}$/); assert.match(stderr_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(identity, expected[index]);
  }
}

export function qualifyMigration(lockBytes) {
  const original = historicalLock(), target = JSON.parse(lockBytes);
  const platform = 'linux/' + ({x64: 'amd64', arm64: 'arm64'}[process.arch]);
  assert(['linux/amd64', 'linux/arm64'].includes(platform));
  const root = mkdtempSync('/tmp/prismpm-migration-'), path = join(root, 'prismpm.lock');
  const processes = [];
  function invoke(args, refusal) {
    const before = readFileSync(path);
    const result = spawnSync('/usr/local/bin/prismpm', ['--json', '--project', root, ...args],
      {encoding: 'utf8', timeout: 240000, maxBuffer: 192 * 1024 * 1024});
    assert.ifError(result.error); assert.equal(result.signal, null);
    assert(readFileSync(path).equals(before), 'installed command changed lock');
    assert.deepEqual(readdirSync(root), ['prismpm.lock'], 'installed command wrote project output');
    const value = JSON.parse(result.stdout);
    if (refusal) {
      assert.equal(result.status, 4);
      assert.equal(value.schema, 'prismpm/error-result/1');
      assert.equal(value.diagnostic.code, 'PP5401');
      assert.equal(value.diagnostic.message, refusal);
    } else assert.equal(result.status, 0);
    processes.push({argv: args, exit_code: result.status, input_sha256: hash(before),
      stdout_sha256: hash(result.stdout), stderr_sha256: hash(result.stderr)});
    return value;
  }
  const put = bytes => { chmodSync(root, 0o700); writeFileSync(path, bytes, {mode: 0o600}); };
  try {
    put(original.document);
    invoke(['lock', 'check'], 'legacy SDK inventory disagrees with the running SDK');
    chmodSync(path, 0o400); chmodSync(root, 0o500);
    const proposal = invoke(['lock', 'migrate', '--sdk-image', target.sdk_image, '--standards-lock', target.standards_lock]);
    assert.deepEqual(proposal, {schema: 'prismpm/sdk-lock-migration/1', compatibility_review: 'required',
      generated_output_diff: 'required', security_review: 'required',
      patch: [{op: 'test', path: '', value: JSON.parse(original.document)}, {op: 'replace', path: '', value: target}]});
    chmodSync(root, 0o700); chmodSync(path, 0o600);
    put(canonical(proposal.patch[1].value));
    assert.deepEqual(invoke(['lock', 'check']), target);
    for (const mutant of inventoryMutants(target, platform)) {
      put(canonical(mutant)); invoke(['lock', 'check'], 'SDK platform inventory disagrees with the running SDK');
    }
    assert.equal(processes.length, 5);
    const evidence = {schema: 'prismpm/installed-lock-migration/2', platform, processes,historical_source:original.authority,
      historical_sha256: original.source.sha256, target_sha256: hash(lockBytes), proposal, checks: [...migrationChecks]};
    verifyMigration(evidence, lockBytes);
    return evidence;
  } finally { chmodSync(root, 0o700); rmSync(root, {recursive: true}); }
}
