import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {frozenInputs,sourceClosure,assertCapturedPayloadSources} from './compile.mjs';
import {payloadCorpus} from './checks.mjs';
import {boundaryLengths,capturePayloadSources,expectedDescriptor} from './browser.mjs';
import {payloadJourneys} from './journeys.mjs';
import {payloadHostMutations,mutatePayloadHost} from './mutations.mjs';
import {decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {payloadStream} from './stream.mjs';
import {verifyPayloadObservationCounts} from './browser.mjs';

test('payload fixture delegates every byte entry to its actual modeled source',()=>{
  const sources=sourceClosure(),fixture=JSON.parse(/\\semanticdata\{(.*)\}/.exec(sources.get('Fixture').toString())[1]);
  assert.deepEqual(fixture.declarations.map(row=>[row.name,row.body.function.name]),[
    ['payloadJournalBytes','journalWireBytes'],['payloadPartitionBytes','journalPartitionBytes'],['payloadRetentionBytes','sessionRetentionWireBytes']]);
  assert.ok(sources.has('Foundation.Browser.Application.V1.OperationJournal'));
  assert.ok(sources.has('Foundation.Browser.Application.V1.SessionJournalRetention'));
  for(const row of fixture.declarations)assert.equal(row.body.kind,'call');
});

test('payload observation framing rejects missing, repeated and reordered records or byte parts',()=>{
  const valid=payloadStream();valid.begin(0,2,3);valid.part(0,'request',0,2);valid.part(0,'response',0,3);valid.end(0);valid.closed();
  assert.throws(()=>valid.end(0),/active observation/);assert.throws(()=>valid.begin(0,1,1),/cannot repeat/);
  for(const defect of ['unfinished','begin','early-end','response-first','gap','repeat','wrong-id']) {
    const stream=payloadStream();stream.begin(1,2,3);
    const action={unfinished:()=>stream.closed(),begin:()=>stream.begin(2,1,1),'early-end':()=>stream.end(1),
      'response-first':()=>stream.part(1,'response',0,1),gap:()=>stream.part(1,'request',1,1),
      repeat:()=>{stream.part(1,'request',0,1);stream.part(1,'request',0,1);},'wrong-id':()=>stream.part(2,'request',0,1)}[defect];
    assert.throws(action,assert.AssertionError,defect);
  }
  const calls=['journal','partition','retention'].map(entry=>({entry})),expected={journal:1,partition:1,retention:1};
  verifyPayloadObservationCounts(calls,expected);
  assert.throws(()=>verifyPayloadObservationCounts(calls.slice(1),expected),/every actual generated browser invocation/);
  assert.throws(()=>verifyPayloadObservationCounts([{entry:'retention'},...calls.slice(1)],expected),/every actual generated browser invocation/);
});
test('payload owner captures complete compiler, source, artifact and browser module inputs',()=>{
  const inputs=frozenInputs(),sources=sourceClosure();assertCapturedPayloadSources(inputs,sources);
  for(const path of ['tests/browser-view/generated-package.mjs','tests/browser-view/generated-wasm.mjs',
    'tests/browser-session-payloads/browser.mjs','tests/browser-session-payloads/journeys.mjs','sdk/browser/session-payloads.mjs',
    'sdk/browser/browser-test-server.mjs','sdk/oracles/package-lock.json'])assert.ok(inputs[path],path);
  const changed=new Map(sources);changed.set('Fixture',Buffer.from('substituted'));
  assert.throws(()=>assertCapturedPayloadSources(inputs,changed),/actual captured source/);
  changed.delete('Fixture');assert.throws(()=>assertCapturedPayloadSources(inputs,changed),/complete captured source/);
  const original=capturePayloadSources(inputs);assert.ok(Object.isFrozen(original));
  assert.throws(()=>capturePayloadSources({...inputs,'sdk/browser/session-payloads.mjs':'0'.repeat(64)}),/original captured SDK/);
});
test('payload acceptance retains complete finite corpora, full maximum and actual host mutations',()=>{
  const rows=payloadCorpus();assert.equal(rows.retention.length,86);assert.equal(rows.partition.length,7);
  assert.equal(rows.journal.length,68);assert.equal(payloadJourneys.length,19);
  assert.deepEqual(boundaryLengths,[1,1048575,1048576,1048577,15728640,16777216,16777217,67108864]);
  const maximum=decodeEffectWire(expectedDescriptor(67108864));assert.equal(maximum[1],67108864);assert.equal(maximum[2].length,64);
  const repeated=decodeEffectWire(expectedDescriptor(67108864,true));assert.equal(repeated[2].length,64);
  assert.ok(repeated[2].every(value=>Buffer.from(value).equals(Buffer.from(repeated[2][0]))));
  assert.equal(payloadHostMutations.length,10);
  for(const mutation of payloadHostMutations) {
    const source=readFileSync(new URL('../../sdk/browser/'+(mutation.module??'session-payloads.mjs'),import.meta.url),'utf8');
    assert.notEqual(mutatePayloadHost(source,mutation),source);
  }
});
