import assert from 'node:assert/strict';
import {statfsSync} from 'node:fs';
import test from 'node:test';
import {capacityDomain, capacityObjectDigest, capacitySnapshot, requireCapacityReserve} from './capacity.mjs';
import {decodeRetentionWire} from '../../sdk/browser/session-retention-wire.mjs';

test('capacity fixture retains the complete jointly bounded storage domain', () => {
  assert.ok(Object.isFrozen(capacityDomain));
  assert.deepEqual(capacityDomain,{objects:4096,roots:64,chunk:1048576,additions:16,initialBatches:256,finalRevision:384});
  assert.equal(capacityDomain.initialBatches*capacityDomain.additions,capacityDomain.objects);
  assert.equal(capacityDomain.objects*capacityDomain.chunk,4294967296);
  assert.equal(capacityDomain.initialBatches+capacityDomain.roots+(capacityDomain.roots-1)+1,capacityDomain.finalRevision);
});

test('an actually small filesystem refuses capacity work instead of reducing the domain', () => {
  const stat=statfsSync('/tmp',{bigint:true});
  assert.ok(stat.bavail*stat.bsize<12n*1073741824n,'pinned browser devcontainer uses a bounded temporary filesystem');
  assert.throws(()=>requireCapacityReserve('/tmp'),/12 GiB free; no reduced-domain fallback/);
  assert.throws(()=>requireCapacityReserve('/tmp',true),/20 GiB free; no reduced-domain fallback/);
});

test('independent full frontiers retain exact names, heads and every referenced object', () => {
  const ids=Array.from({length:4112},(_,index)=>{const value=Buffer.alloc(32);value.writeUInt32BE(index);return value;});
  const catalogue=ids.slice(0,4096),additions=ids.slice(4096),equal=(a,b)=>assert.deepEqual(Buffer.from(a),Buffer.from(b));
  for(const phase of ['full','released','replaced']) {
    const bytes=capacitySnapshot(catalogue,additions,phase),value=decodeRetentionWire(bytes);
    assert.ok(bytes.length>8900000&&bytes.length<67108864);assert.equal(value[1],{full:320,released:383,replaced:384}[phase]);
    assert.equal(value[2].length,4096);assert.equal(value[3].length,64);
    for(let index=0;index<64;index++) {
      const [name,head,refs]=value[3][index];assert.equal(name,('root-'+String(index).padStart(2,'0')+'-').padEnd(128,'x'));
      equal(head,phase==='replaced'&&index===0?additions[0]:catalogue[index]);
      const expected=phase==='full'||phase==='released'&&index===0?catalogue:
        phase==='replaced'&&index===0?[...catalogue.slice(0,4080),...additions]:catalogue.slice(0,4080);
      assert.equal(refs.length,expected.length);for(let at=0;at<refs.length;at++)equal(refs[at],expected[at]);
    }
  }
});

test('deterministic full-size object oracle keeps distinct counter domains', () => {
  const values=[0,1,4095,4111].map(index=>capacityObjectDigest(index).toString('hex'));
  assert.equal(new Set(values).size,4);assert.equal(capacityObjectDigest(0).toString('hex'),values[0]);
  for(const invalid of [-1,4112,0.5])assert.throws(()=>capacityObjectDigest(invalid));
});
