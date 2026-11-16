// Actual generated Wasm component controls. Only this conformance probe knows
// the neutral fixture's source-owned event/observation byte vectors.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [runtimePath,bindingPath,wasmPath]=process.argv.slice(2);
assert.equal(process.argv.length,5);assert.equal(typeof global.gc,'function');
const {createRetainedResourceAdapter,retainedResourceProtocol,privateRetainedQuarantinedOwnerCount}=await import(pathToFileURL(runtimePath).href);
const wasm=readFileSync(wasmPath),all=Uint8Array.from({length:256},(_,i)=>i);
const limits={maximumConfigBytes:1024,maximumEventBytes:32,maximumObservationBytes:1024,maximumSessions:8};
let serial=0;
async function owner(custom={}){
 const binding=await import(pathToFileURL(bindingPath).href+'?instance='+(++serial));
 const exports=await binding.default({module_or_path:wasm});
 const resources=[],calls=[];let releases=0,retirements=0,trapNext=false;
 const backend={protocol:retainedResourceProtocol,
  init(bytes){calls.push('init');const response=binding.begin(bytes);if(response.kind==='ready')resources.push(response.resource);return response;},
  advance(resource,bytes){calls.push('advance');if(trapNext){trapNext=false;binding.trap_for_probe();}return resource.advance(bytes);},
  requestRelease(resource){calls.push('requestRelease');return resource.request_release();},
  release(resource){calls.push('release');releases++;resource.free();}
 };
 const runtime=createRetainedResourceAdapter({backend,limits:{...limits,...custom},retire(){retirements++;}});
 return {runtime,binding,exports,resources,calls,trap(){trapNext=true;},get releases(){return releases;},get retirements(){return retirements;}};
}
function retained(result,header){assert.equal(result.kind,'retained');assert.deepEqual([...result.observation.subarray(0,7)],header);return result.observation;}
const event=code=>Uint8Array.of(code);
const first=await owner(),foreign=await owner(),config=all.slice();
const ready=await first.runtime.init(config),other=await foreign.runtime.init(all);
assert.equal(ready.kind,'ready');assert.equal(other.kind,'ready');
assert.equal(first.resources[0].__wbg_ptr,foreign.resources[0].__wbg_ptr,'independent real guests deliberately collide raw resource addresses');
assert.notEqual(first.exports.memory.buffer,foreign.exports.memory.buffer);
assert.equal((await first.runtime.advance(other.session,event(1))).code,'ForeignSession');
assert.equal((await foreign.runtime.requestRelease(ready.session)).code,'ForeignSession');
retained(await first.runtime.requestRelease(ready.session),[9,0,0,0,0,0,0]);
retained(await first.runtime.advance(ready.session,new Uint8Array()),[7,0,0,0,0,0,0]);
config.fill(77);
retained(await first.runtime.advance(ready.session,event(1)),[1,0,1,1,0,0,0]);
retained(await first.runtime.advance(ready.session,event(12)),[7,0,1,1,0,0,0]);
retained(await first.runtime.advance(ready.session,event(15)),[7,0,1,1,0,0,0]);
retained(await first.runtime.advance(ready.session,event(2)),[3,0,1,1,1,0,0]);
retained(await first.runtime.advance(ready.session,event(14)),[7,0,1,1,1,0,0]);
const complete=retained(await first.runtime.advance(ready.session,event(9)),[4,1,1,1,1,0,0]);
assert.deepEqual([...complete.subarray(7)],[...all],'actual typed State retained config across source transitions');
first.exports.memory.grow(1);assert.deepEqual([...complete.subarray(7)],[...all]);
assert.equal(first.binding.live_wrappers(),1,'semantic completion did not destroy State');assert.equal(first.releases,0);
retained(await first.runtime.requestRelease(ready.session),[9,1,1,1,1,0,0]);
retained(await first.runtime.advance(ready.session,event(10)),[5,2,1,1,1,0,0]);
retained(await first.runtime.requestRelease(ready.session),[9,2,1,1,1,0,0]);
retained(await first.runtime.advance(ready.session,event(4)),[8,2,1,1,1,0,1]);
retained(await first.runtime.requestRelease(ready.session),[9,2,1,1,1,0,1]);
retained(await first.runtime.advance(ready.session,event(3)),[7,2,1,1,1,0,1]);
retained(await first.runtime.advance(ready.session,event(11)),[3,2,0,0,1,0,0]);
retained(await first.runtime.requestRelease(ready.session),[9,2,0,0,1,0,0]);
retained(await first.runtime.advance(ready.session,event(5)),[2,2,2,2,1,0,0]);
retained(await first.runtime.advance(ready.session,event(6)),[3,2,0,0,1,1,0]);
const released=await first.runtime.requestRelease(ready.session);assert.equal(released.kind,'released');assert.equal(released.observation[0],10);
assert.equal(first.binding.live_wrappers(),0);assert.equal(first.binding.granted_drops(),1);assert.equal(first.releases,1);
assert.equal((await first.runtime.advance(ready.session,event(1))).code,'StaleSession');
assert.equal((await first.runtime.requestRelease(ready.session)).code,'StaleSession');

const modeled=await first.runtime.init(Uint8Array.of(42));
for(const [code,header] of [[1,[1,0,1,1,0,0,0]],[2,[3,0,1,1,1,0,0]],[18,[6,3,1,1,1,0,0]],
 [3,[3,3,0,0,2,0,0]],[5,[2,3,2,2,2,0,0]],[6,[3,3,2,2,2,1,0]],[13,[7,3,2,2,2,1,0]],[8,[8,3,2,2,2,1,1]]])
 retained(await first.runtime.advance(modeled.session,event(code)),header);
retained(await first.runtime.requestRelease(modeled.session),[9,3,2,2,2,1,1]);
retained(await first.runtime.advance(modeled.session,event(17)),[3,3,0,0,2,2,0]);
assert.equal((await first.runtime.requestRelease(modeled.session)).kind,'released');assert.equal(first.releases,2);
assert.equal((await first.runtime.close()).kind,'closed');assert.equal(first.retirements,1);
assert.equal((await foreign.runtime.close()).code,'OwnersRetained');
retained(await foreign.runtime.advance(other.session,event(9)),[4,1,0,0,0,0,0]);
assert.equal((await foreign.runtime.requestRelease(other.session)).kind,'released');await foreign.runtime.close();

// Real post-dispatch observation bound failure: the exact successor/raw owner
// remains held; retry does not replay advance or invent a source acknowledgment.
const limited=await owner({maximumObservationBytes:16}),limitedReady=await limited.runtime.init(all);
const late=await limited.runtime.advance(limitedReady.session,event(9));assert.equal(late.code,'ObservationLimit');assert.equal(late.ownership,'retained');
const lateCalls=limited.calls.length;
assert.equal((await limited.runtime.requestRelease(limitedReady.session)).code,'ObservationPending');
assert.equal((await limited.runtime.advance(limitedReady.session,event(10))).code,'ObservationPending');
assert.equal((await limited.runtime.retryObservation(limitedReady.session)).code,'ObservationLimit');
assert.equal(limited.calls.length,lateCalls);assert.ok(limited.resources[0].__wbg_ptr>0);assert.equal(limited.releases,0);
const lateAbandon=await limited.runtime.abandon();assert.equal(lateAbandon.ownership,'unknown');assert.equal(limited.retirements,1);

// Real GC pressure while an owner is retained. The runtime's strong custody
// prevents caller-object loss from becoming an implicit destructor grant.
let gcOwner=await owner(),gcSession=await gcOwner.runtime.init(Uint8Array.of(8));
const gcBinding=gcOwner.binding;gcOwner=null;gcSession=null;
for(let i=0;i<4;i++){global.gc();await new Promise(resolve=>setImmediate(resolve));}
assert.equal(gcBinding.live_wrappers(),1);
// Intentional indefinite retention; this does not establish physical reclamation.

const checked=await owner(),checkedReady=await checked.runtime.init(Uint8Array.of(7));
const checkedOther=await checked.runtime.init(Uint8Array.of(9));
await checked.runtime.advance(checkedReady.session,event(1));await checked.runtime.advance(checkedReady.session,event(2));
const error=await checked.runtime.advance(checkedReady.session,event(253));
assert.deepEqual(error,{kind:'computeError',code:'AddOverflow',ownership:'retained',recovery:'blocked'});
const checkedCalls=checked.calls.length;
for(const operation of [()=>checked.runtime.advance(checkedReady.session,event(10)),()=>checked.runtime.requestRelease(checkedReady.session),
 ()=>checked.runtime.advance(checkedOther.session,event(9)),()=>checked.runtime.init(all),()=>checked.runtime.close(),()=>checked.runtime.retryObservation(checkedReady.session)])
 assert.equal((await operation()).code,'ComputeFailureHeld');
assert.equal(checked.calls.length,checkedCalls);assert.equal(checked.releases,0);
assert.equal((await checked.runtime.abandon()).ownership,'unknown');assert.equal(checked.retirements,1);
// No guest observer/destructor is called after checked error or actual trap.
const quarantined=privateRetainedQuarantinedOwnerCount(),trapped=await owner(),trappedReady=await trapped.runtime.init(Uint8Array.of(4));
trapped.trap();const fatal=await trapped.runtime.advance(trappedReady.session,event(1));
assert.equal(fatal.kind,'fatal');assert.equal(fatal.code,'BackendTrap');assert.equal(fatal.ownership,'unknown');
assert.equal(trapped.releases,0);assert.equal(trapped.retirements,1);
assert.equal(privateRetainedQuarantinedOwnerCount(),quarantined+1);
const trappedCalls=trapped.calls.length;
assert.equal((await trapped.runtime.requestRelease(trappedReady.session)).code,'InstancePoisoned');assert.equal(trapped.calls.length,trappedCalls);
console.log('private generated retained-state Wasm component passed: '+JSON.stringify({
 allBytes:256,sourceReleaseGrants:3,lateObservationBound:'retained-without-replay',checkedFailure:'whole-instance-held',gcCalls:4,
 physicalMemoryBoundClaimed:false,hiddenPrefixRecoveryClaimed:false,workerTerminationClaimed:false,publicationClaimed:false,retentionMayBeIndefinite:true
}));
