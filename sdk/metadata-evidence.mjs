// Private gate evidence; raw OCI input custody is not installed SDK acceptance.
import assert from 'node:assert/strict';
import {captureMetadataLock} from './metadata-capture.mjs';
import {limits,sha} from './metadata-layer.mjs';

const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const keys=(value,names)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),names.slice().sort());
};
const budget=5*limits.document+2*limits.compressed;
const decode=(text,maximum)=>{
  assert.equal(typeof text,'string');assert(text.length<=4*Math.ceil(maximum/3));
  const bytes=Buffer.from(text,'base64');assert(bytes.length<=maximum);
  assert.equal(bytes.toString('base64'),text,'canonical original metadata encoding required');return bytes;
};

export async function captureMetadataEvidence(reference,standardsDigest,transport) {
  const objects=[];let start,started_ms,total=0;
  const lock=await captureMetadataLock(reference,standardsDigest,async request=>{
    assert(Number.isFinite(start)&&Number.isSafeInteger(started_ms));
    const original=await transport(request);
    assert(Buffer.isBuffer(original)&&original.length<=request.maximum);
    total+=original.length;assert(total<=budget&&objects.length<7);
    // Copy during the same synchronous turn before any later transport call.
    const bytes=Buffer.from(original);
    objects.push({...request,started_ms,ended_ms:Math.ceil(performance.now()-start),
      byte_length:bytes.length,digest:sha(bytes),base64:bytes.toString('base64')});
    return bytes;
  },(origin,requested)=>{start=origin;started_ms=Math.floor(requested-origin);});
  const evidence={schema:'prismpm/sdk-metadata-inputs/1',scope:'metadata-input-provenance-only',
    sdk_image:reference,standards_lock:standardsDigest,lock_digest:sha(canonical(lock)),objects};
  await verifyMetadataEvidence(evidence,Buffer.from(canonical(lock)));
  return {lock,evidence};
}

export async function verifyMetadataEvidence(value,lockBytes) {
  keys(value,['schema','scope','sdk_image','standards_lock','lock_digest','objects']);
  assert.equal(value.schema,'prismpm/sdk-metadata-inputs/1');
  assert.equal(value.scope,'metadata-input-provenance-only');
  assert(Buffer.isBuffer(lockBytes)&&lockBytes.length>0&&lockBytes.length<=64*1024*1024);
  assert.equal(value.lock_digest,sha(lockBytes));
  assert(Array.isArray(value.objects)&&value.objects.length===7,'exact seven raw OCI objects required');
  let next=0,total=0,previousStart=0,previousEnd=0;
  const lock=await captureMetadataLock(value.sdk_image,value.standards_lock,async request=>{
    const row=value.objects[next++];
    keys(row,['kind','reference','maximum','timeout_ms','started_ms','ended_ms','byte_length','digest','base64']);
    for(const field of ['kind','reference','maximum'])assert.equal(row[field],request[field]);
    assert(Number.isSafeInteger(row.timeout_ms)&&row.timeout_ms>0&&row.timeout_ms<=45000);
    assert(Number.isSafeInteger(row.started_ms)&&Number.isSafeInteger(row.ended_ms));
    assert(row.started_ms>=previousStart&&row.started_ms>=previousEnd-1&&row.ended_ms>=row.started_ms);
    // Replay cannot compare a freshly computed remaining deadline with the
    // original request. Bind it to the exact acquisition clock instead,
    // allowing only the one-millisecond outward rounding of that clock.
    assert(row.timeout_ms>=Math.min(45000,180000-row.started_ms-1)
      &&row.timeout_ms<=Math.min(45000,180000-row.started_ms+1),
    'original request timeout must match its remaining capture deadline');
    assert(row.ended_ms<=180001&&row.ended_ms-row.started_ms<=row.timeout_ms+1,'original capture deadline required');
    previousStart=row.started_ms;previousEnd=row.ended_ms;
    const bytes=decode(row.base64,request.maximum);
    assert.equal(row.byte_length,bytes.length);assert.equal(row.digest,sha(bytes));
    total+=bytes.length;assert(total<=budget);return bytes;
  });
  assert.equal(next,7);assert(Buffer.from(canonical(lock)).equals(lockBytes),'original lock must replay exactly');
  return lock;
}

export async function joinNativeMetadata(evidence,lockBytes,rows,revision) {
  assert.match(revision,/^[a-f0-9]{40}$/);
  const lock=await verifyMetadataEvidence(evidence,lockBytes);
  assert(Array.isArray(rows)&&rows.length===2,'both actual native lanes required');
  assert.deepEqual(rows.map(row=>row.platform),['linux/amd64','linux/arm64']);
  const platforms=rows.map((row,index)=>{
    keys(row,['platform','sdk_image','source_revision','inventory_document','standards_base64']);
    assert.equal(row.sdk_image,lock.sdk_image);assert.equal(row.source_revision,revision);
    assert.equal(typeof row.inventory_document,'string');
    assert(Buffer.byteLength(row.inventory_document)<=limits.inventory);
    const inventory=Buffer.from(row.inventory_document),standards=decode(row.standards_base64,limits.standards);
    assert(inventory.equals(Buffer.from(lock.platforms[index].inventory_document)),
      'metadata inventory differs from independently materialized native bytes');
    assert.equal(sha(standards),lock.standards_lock);
    if(index)assert.equal(row.standards_base64,rows[0].standards_base64,'native standards bytes differ');
    return {platform:row.platform,manifest_digest:lock.platforms[index].manifest_digest,
      inventory_digest:sha(inventory),standards_digest:sha(standards)};
  });
  return {schema:'prismpm/sdk-metadata-native-join/1',scope:'metadata-native-byte-equivalence-only',
    source_revision:revision,sdk_image:lock.sdk_image,lock_digest:sha(lockBytes),
    metadata_evidence_digest:sha(canonical(evidence)),platforms,
    unclaimed:['full-VV','installed-SDK-acceptance','product-readiness','consumer-adoption']};
}
