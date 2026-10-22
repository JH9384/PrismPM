import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyBrowserTranscript} from './browser.mjs';
import {corpus} from './corpus.mjs';
test('browser evidence requires every exact actual request/response and allocator observation',()=>{
  const baseline={engine:'webkit',calls:corpus().map(row=>({id:row.id,request:row.request.toString('hex'),
    response:row.response.toString('hex'),repeats:2})),maximumBytes:65536,imports:0,
    allocatorMaximum:1024,allocatorFirstOverRejected:true};
  verifyBrowserTranscript(baseline,'webkit');
  for(const mutate of [value=>value.calls.pop(),value=>value.calls[0].id='unknown',
    value=>value.calls[0].request='83010480',value=>value.calls[0].response='830100f4',
    value=>value.calls[0].repeats=0,value=>value.imports=1,value=>value.allocatorMaximum=512,
    value=>value.allocatorFirstOverRejected=false,value=>value.maximumBytes=1073741825]){
    const changed=structuredClone(baseline);mutate(changed);assert.throws(()=>verifyBrowserTranscript(changed,'webkit'));
  }
});
