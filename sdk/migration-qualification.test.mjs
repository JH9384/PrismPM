// Parser falsification only; real installed execution belongs to the native gate.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {historicalLock,verifyHistoricalFixture,migrationChecks,verifyMigration,expectedMigrationProcesses,inventoryMutants} from './migration-qualification.mjs';
import {lockFixture} from '../scripts/library-sdk-fixture.mjs';
import * as migration from './migration-qualification.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('historical migration source proves the pinned commit/tree/blob closure',()=>{
  assert.equal(typeof migration.verifyHistoricalSource,'function');
  const historical=historicalLock();
  assert.equal(historical.authority.revision,historical.source.revision);
  assert.equal(historical.authority.blob_oid,historical.source.git_blob);
  assert.deepEqual(migration.verifyHistoricalSource(historical.document),historical.authority);
  const source=JSON.parse(readFileSync(new URL('./fixtures/hologram-live-historical-source.json',import.meta.url)));
  for(const mutate of [value=>value.extra=true,value=>value.schema='other',value=>value.repository='https://github.com/other/repo',
    value=>value.revision='0'.repeat(40),value=>value.path='other.lock',value=>value.blob_oid='0'.repeat(40),
    value=>value.document_sha256='0'.repeat(64),value=>value.commit.git_oid='0'.repeat(40),
    value=>value.commit.extra=true,value=>value.commit.sha256='0'.repeat(64),value=>value.tree.git_oid='0'.repeat(40),
    value=>value.tree.sha256='0'.repeat(64),value=>value.tree.base64+='\n',
    value=>value.commit.base64=Buffer.from('tree '+value.tree.git_oid+'\n\nnot the pinned commit').toString('base64'),
    value=>{const bytes=Buffer.from(value.tree.base64,'base64');bytes[0]^=1;value.tree.base64=bytes.toString('base64');value.tree.sha256=targetHash(bytes);}
  ]) {
    const invalid=structuredClone(source);mutate(invalid);
    assert.throws(()=>migration.verifyHistoricalSource(historical.document,Buffer.from(migration.canonical(invalid)+'\n')));
  }
  const bytes=Buffer.from(migration.canonical(source)+'\n');
  for(const invalid of [Buffer.alloc(0),Buffer.alloc(65537),Buffer.from([0xff]),Buffer.concat([bytes,Buffer.from('\n')])])
    assert.throws(()=>migration.verifyHistoricalSource(historical.document,invalid));
  assert.throws(()=>migration.verifyHistoricalSource(historical.document+' ',bytes));
  assert.throws(()=>migration.verifyHistoricalSource('x'.repeat(128*1024+1),bytes));
});

function targetHash(bytes){return createHash('sha256').update(bytes).digest('hex');}

function fixture() {
  const target=lockFixture(),historical=historicalLock();
  return {target,value:{schema:'prismpm/installed-lock-migration/2',platform:'linux/amd64',historical_source:historical.authority,
    historical_sha256:historical.source.sha256,target_sha256:target.hash(target.bytes),checks:[...migrationChecks],
    processes:expectedMigrationProcesses(target.lock,'linux/amd64').map(row=>({...row,stdout_sha256:'1'.repeat(64),stderr_sha256:'2'.repeat(64)})),
    proposal:{schema:'prismpm/sdk-lock-migration/1',compatibility_review:'required',generated_output_diff:'required',security_review:'required',
      patch:[{op:'test',path:'',value:JSON.parse(historical.document)},{op:'replace',path:'',value:target.lock}]}}};
}
test('migration reader binds original historical bytes and complete independent target',()=>{
  const historical=historicalLock();
  const original=JSON.parse(readFileSync(new URL('./fixtures/hologram-live-historical-lock.json',import.meta.url)));
  assert.deepEqual(verifyHistoricalFixture(original),historical);
  for(const change of [v=>delete v.objects,v=>v.objects.extra='unclaimed',v=>v.objects.commit_base64='',
    v=>v.objects.tree_base64+='\n',v=>v.objects.tree_base64=Buffer.from('foreign tree').toString('base64'),
    v=>v.objects.commit_base64=Buffer.from(Buffer.from(v.objects.commit_base64,'base64').toString()+'changed').toString('base64'),
    v=>v.objects.tree_base64=Buffer.alloc(65537).toString('base64'),
    v=>v.source.git_blob='0'.repeat(40),v=>v.source.revision='0'.repeat(40),v=>v.document+='\n']){
    const changed=structuredClone(original);change(changed);assert.throws(()=>verifyHistoricalFixture(changed));
  }
  const {target,value}=fixture();verifyMigration(value,target.bytes);
  const legacy=structuredClone(value);delete legacy.historical_source;legacy.schema='prismpm/installed-lock-migration/1';
  verifyMigration(legacy,target.bytes); // Historical reader only; installed gate rejects /1.
  for(const change of [v=>v.historical_sha256='0'.repeat(64),v=>v.target_sha256='0'.repeat(64),
    v=>v.platform='linux/other',v=>v.extra=true,v=>v.checks.pop(),v=>v.checks.reverse(),
    v=>v.proposal.patch.reverse(),v=>v.proposal.patch.shift(),v=>v.proposal.patch[0].value.inventory.pop(),
    v=>v.proposal.patch[1].value.platforms.reverse(),v=>v.proposal.security_review='complete',
    v=>v.proposal.patch[1].path='/platforms',v=>v.proposal.patch[1].value.platforms[0].inventory.pop(),
    v=>v.processes.pop(),v=>v.processes[0].exit_code=0,v=>v.processes[2].input_sha256='0'.repeat(64),
    v=>v.processes[1].argv.pop(),v=>v.processes[4].stdout_sha256='missing',
    v=>delete v.historical_source,v=>v.historical_source.tree_oid='0'.repeat(40),
    v=>v.historical_source.scope='sdk-release',v=>v.historical_source.source_document_sha256='0'.repeat(64)]) {
    const invalid=structuredClone(value);change(invalid);assert.throws(()=>verifyMigration(invalid,target.bytes));
  }
  assert.throws(()=>verifyMigration(value,Buffer.from(target.bytes+'\n')));
  for(const mutant of inventoryMutants(target.lock,'linux/amd64')) {
    assert.deepEqual(mutant.platforms.map(row=>[row.platform,row.manifest_digest]),target.lock.platforms.map(row=>[row.platform,row.manifest_digest]));
    for(const row of mutant.platforms) {
      assert.deepEqual(JSON.parse(row.inventory_document).artifacts,row.inventory);
      assert.equal(row.inventory_digest,'sha256:'+target.hash(row.inventory_document));
    }
    assert.notEqual(mutant.platforms[0].inventory_digest,target.lock.platforms[0].inventory_digest);
  }
});
