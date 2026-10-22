// Closed observation framing, independent of the generated model's semantics.
import assert from 'node:assert/strict';
export function payloadStream() {
  let active=null,last=-1;
  return Object.freeze({
    begin(id,request,response) {
      assert.equal(active,null,'previous generated observation must end');
      assert.ok(Number.isSafeInteger(id)&&id>last,'observation IDs cannot repeat or reverse');
      for(const length of [request,response])assert.ok(Number.isInteger(length)&&length>=0&&length<=67108864);
      active={id,request,response,requestAt:0,responseAt:0};last=id;
    },
    part(id,kind,offset,length) {
      assert.ok(active&&active.id===id,'active observation required');
      assert.ok(['request','response'].includes(kind));
      assert.ok(Number.isInteger(length)&&length>0&&length<=262144);
      if(kind==='response')assert.equal(active.requestAt,active.request,'request precedes response');
      assert.equal(offset,active[kind+'At'],'no missing, repeated or reordered observation bytes');
      assert.ok(offset+length<=active[kind]);active[kind+'At']+=length;
    },
    end(id) {
      assert.ok(active&&active.id===id,'active observation required');
      assert.equal(active.requestAt,active.request,'complete request required');
      assert.equal(active.responseAt,active.response,'complete response required');active=null;
    },
    closed(){assert.equal(active,null,'no unfinished generated observation');},
  });
}
