// Closed fixture authoring from the unchanged accepted reducer corpus.
import { readSemantic, toNotation } from '../../scripts/semantic-source.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../../stdlib/src/Foundation/Browser/V1/WorkspaceCorpus.lex.tex',import.meta.url),'utf8');
const payload=readSemantic(source);
const original=new Map(payload.declarations.map(d=>[d.name,d]));
const cache=new Map();
function fixture(name){if(cache.has(name))return cache.get(name);function bytes(x){if(x.kind==='bytes')return Buffer.from(x.hex,'hex');if(x.kind==='call')return fixture(x.function.name);if(x.kind==='primitive'&&x.operation==='append')return Buffer.concat(x.arguments.map(bytes));throw Error('fixture expression');}const b=bytes(original.get(name).body);cache.set(name,b);return b;}
const sha=b=>createHash('sha256').update(b).digest();
const concat=(...b)=>Buffer.concat(b.map(x=>Buffer.isBuffer(x)?x:Buffer.from(x)));
const u24=n=>Buffer.from([n>>>16,n>>>8&255,n&255]);
const u16=n=>Buffer.from([n>>>8,n&255]);
const empty=Buffer.alloc(0),zero=Buffer.alloc(32);
const envelope=event=>concat([0x50,0x57,0x45,1],Buffer.concat([Buffer.from([4]),Buffer.alloc(64,7)]),Buffer.alloc(64,9),event);
function parts(request){const n=request.readUIntBE(4,3);return {state:request.subarray(7,7+n),event:request.subarray(7+n)};}
function stateHead(state){if(!state.length)return empty;const members=state.readUInt16BE(101),messages=state.readUIntBE(103,3),seen=state.subarray(108+members+messages);const rows=[];for(let at=0;at<seen.length;at+=32){const id=seen.subarray(at,at+32);rows.push(id,sha(concat(Buffer.from('structural-journal-fixture/1'),id)));}return concat([0x50,0x57,0x4a,1],state.subarray(1,33),u16(rows.length/2),...rows);}
function nextHead(head,event,id){return concat([0x50,0x57,0x4a,1],event.subarray(2,34),u16(head.length?(head.length-38)/64+1:1),head.subarray(38),event.subarray(34,66),id);}
const append=(head,state,id,env)=>concat([1],u24(head.length),u24(state.length),head,state,id,env);
const plan=(head,state)=>concat([0],u24(head.length),u24(state.length),head,state);
const replay=(target,request)=>concat([3],u24(target.length),target,request.subarray(1));
const complete=(target,head,state)=>concat([4],u24(target.length),u24(head.length),u24(state.length),target,head,state);
const vectors=[];
function vector(id,request,response){vectors.push({id,request,response});}
const cases=['Genesis','GrantContributor','GrantReader','ContributorPost','OwnerPost','RevokeContributor','ReaderCannotPost','OutsiderCannotPost','ContributorCannotGrant','OwnerCannotRevoke','ReplayRejected','StaleParentRejected','StaleSequenceRejected','WorkspaceMismatchRejected','MaximumMessageAccepted','CombinedMaximumStateControlAccepted'];
const plans=new Map();
for(const name of cases){const {state,event}=parts(fixture('request'+name));const head=stateHead(state),env=envelope(event),id=sha(env),answer=fixture('response'+name);const request=append(head,state,id,env);const next=nextHead(head,event,id);const response=answer[0]===0?plan(next,answer.subarray(1)):concat([16],answer);vector('Append'+name,request,response);if(answer[0]===0)plans.set(name,{state,event,head,env,id,next,nextState:answer.subarray(1),request,response});}
const genesis=plans.get('Genesis'),grant=plans.get('GrantContributor'),max=plans.get('CombinedMaximumStateControlAccepted');
vector('HeadAbsent',Buffer.from([0]),Buffer.from([0]));
vector('HeadGenesis',concat([0],genesis.next),concat([0],genesis.next));
vector('HeadMaximum',concat([0],max.next),concat([0],max.next));
vector('EmptyRequest',empty,Buffer.from([1]));
vector('UnknownOperation',Buffer.from([255]),Buffer.from([11]));
vector('TruncatedAppend',Buffer.from([1,0,0]),Buffer.from([1]));
vector('HeadTruncated',concat([0],genesis.next.subarray(0,-1)),Buffer.from([2]));
vector('HeadTrailing',concat([0],genesis.next,[0]),Buffer.from([2]));
for(const [name,offset,value] of [['Magic',0,0],['Version',3,2],['Count',37,0],['ZeroWorkspace',4,0]]){let bad=Buffer.from(genesis.next);if(name==='ZeroWorkspace')bad.fill(0,4,36);else bad[offset]=value;vector('Head'+name,concat([0],bad),Buffer.from([2]));}
const duplicateEvent=Buffer.from(grant.next);genesis.next.subarray(38,70).copy(duplicateEvent,102);vector('DuplicateEventId',concat([0],duplicateEvent),Buffer.from([2]));
const duplicateObject=Buffer.from(grant.next);duplicateObject.subarray(70,102).copy(duplicateObject,134);vector('DuplicateObjectId',concat([0],duplicateObject),Buffer.from([2]));
vector('StateHeadMismatch',append(grant.head,empty,grant.id,grant.env),Buffer.from([3]));
vector('ZeroObjectId',append(genesis.head,genesis.state,zero,genesis.env),Buffer.from([4]));
vector('ExistingObjectId',append(grant.head,grant.state,grant.head.subarray(70,102),grant.env),Buffer.from([5]));
const full=parts(fixture('requestCombinedMaximumStateRejectedAtEventLimit'));vector('EventLimit',append(max.next,full.state,sha(envelope(full.event)),envelope(full.event)),Buffer.from([6]));
vector('ReplayGenesis',replay(genesis.next,genesis.request),genesis.response);
vector('ReplayMaximumLast',replay(max.next,max.request),max.response);
vector('ReplayWrongObject',replay(genesis.next,append(empty,empty,Buffer.alloc(32,8),genesis.env)),Buffer.from([7]));
vector('ReplayWrongEvent',replay(genesis.next,grant.request),Buffer.from([7]));
vector('ReplayComplete',complete(genesis.next,genesis.next,genesis.nextState),concat([0],genesis.nextState));
vector('ReplayMaximumComplete',complete(max.next,max.next,max.nextState),concat([0],max.nextState));
vector('ReplayIncomplete',complete(grant.next,grant.head,grant.state),Buffer.from([8]));
const attempt=Buffer.alloc(32,7),old=sha(genesis.next),next=sha(grant.next),intent=sha(concat(Buffer.from('prismpm/journal-commit/1\0'),old,next,grant.id));
const session=concat([0],attempt,old,next,intent);
const receipt=(status,actual=old)=>concat([status],session.subarray(1),actual);
const finish=(s,r)=>concat([2],s,r);
vector('CommitIntent',concat([5],old,next,grant.id),concat([0],Buffer.from('prismpm/journal-commit/1\0'),old,next,grant.id));
vector('CommitSuccess',finish(session,receipt(0,next)),concat([0,1],session.subarray(1)));
for(const [status,name] of [[1,'Conflict'],[2,'StorageLimit'],[3,'StorageQuota'],[4,'StorageClosed'],[5,'StorageUnavailable']])vector(name,finish(session,receipt(status,status===1?Buffer.alloc(32,9):old)),concat([32+status,2],session.subarray(1)));
for(const [name,at] of [['Attempt',1],['Expected',33],['Next',65],['Intent',97]]){const bad=receipt(0,next);bad[at]^=1;vector('ReceiptWrong'+name,finish(session,bad),Buffer.from([9]));}
vector('ReceiptWrongObserved',finish(session,receipt(0,old)),Buffer.from([9]));
vector('ReceiptFalseConflict',finish(session,receipt(1,old)),Buffer.from([9]));
vector('ReceiptUnknownStatus',finish(session,receipt(255,old)),Buffer.from([9]));
vector('ReceiptReplayedAfterSuccess',finish(concat([1],session.subarray(1)),receipt(0,next)),Buffer.from([10]));
vector('ReceiptReplayedAfterFailure',finish(concat([2],session.subarray(1)),receipt(0,next)),Buffer.from([10]));
vector('RequestOverAllocationCap',Buffer.alloc(1235981),Buffer.from([1]));
// Separate reachable maximum Post branch: 1 genesis +255 posts +62 grants
// +352 outside-member grant/revoke pairs +last grant =1023; final Post =1024.
const postFull=max.nextState,postMembers=postFull.subarray(108,108+63*33);
const postMessages=postFull.subarray(108+63*33,108+63*33+256*4162);
const postSeen=postFull.subarray(108+63*33+256*4162);
const postBeforeHeader=Buffer.from(postFull.subarray(0,108));postSeen.subarray(1022*32,1023*32).copy(postBeforeHeader,65);
postBeforeHeader.writeUInt16BE(1022,97);postBeforeHeader.writeUInt16BE(255,99);postBeforeHeader.writeUIntBE(255*4162,103,3);postBeforeHeader.writeUInt16BE(1023*32,106);
const postBefore=concat(postBeforeHeader,postMembers,postMessages.subarray(0,255*4162),postSeen.subarray(0,1023*32));
const postEvent=Buffer.alloc(134+4096);postEvent[0]=1;postEvent[1]=4;postFull.subarray(1,33).copy(postEvent,2);postSeen.subarray(1023*32).copy(postEvent,34);postSeen.subarray(1022*32,1023*32).copy(postEvent,66);postFull.subarray(33,65).copy(postEvent,98);postEvent.writeUInt16BE(1023,130);postEvent.writeUInt16BE(4096,132);postEvent.fill(0x61,134);
const postEnvelope=envelope(postEvent),postObject=sha(postEnvelope),postNextHead=nextHead(max.head,postEvent,postObject);
const postAfter=concat(postFull.subarray(0,108),postMembers,postMessages.subarray(0,255*4162),postEvent.subarray(34,66),postEvent.subarray(98,130),postEvent.subarray(132),postSeen);
const postRequest=append(max.head,postBefore,postObject,postEnvelope),postResponse=plan(postNextHead,postAfter);
vector('AppendCombinedMaximumPostAccepted',postRequest,postResponse);
vector('ReplayCombinedMaximumPostAccepted',replay(postNextHead,postRequest),postResponse);
const zeroWorkspaceGenesis=Buffer.from(genesis.env);zeroWorkspaceGenesis.fill(0,135,167);
vector('GenesisCannotCreateInvalidZeroWorkspaceHead',append(empty,empty,sha(zeroWorkspaceGenesis),zeroWorkspaceGenesis),Buffer.from([2]));

const declarations=[],interned=new Map();
const call=name=>({kind:'call',function:{name},arguments:[]});
function constant(expression){const key=JSON.stringify(expression);if(interned.has(key))return call(interned.get(key));const name='fixtureData'+interned.size;interned.set(key,name);declarations.push({kind:'definition',name,parameters:[],result:{kind:'bytes'},body:expression});return call(name);}
const shared=[];
function appendExpression(left,right){return constant({kind:'primitive',operation:'append',result:{kind:'bytes'},arguments:[left,right]});}
function raw(bytes){const chunks=[];for(let at=0;at<bytes.length;at+=256)chunks.push(constant({kind:'bytes',hex:bytes.subarray(at,at+256).toString('hex')}));if(!chunks.length)return {kind:'bytes',hex:''};function tree(rows){if(rows.length===1)return rows[0];const middle=Math.floor(rows.length/2);return appendExpression(tree(rows.slice(0,middle)),tree(rows.slice(middle)));}return tree(chunks);}
const copied=new Map();
function originalNode(x){if(x.kind==='bytes')return raw(Buffer.from(x.hex,'hex'));if(x.kind==='call')return originalExpression(x.function.name);if(x.kind==='primitive'&&x.operation==='append')return appendExpression(...x.arguments.map(originalNode));throw Error('original fixture expression');}
function originalExpression(name){if(copied.has(name))return copied.get(name);const expression=originalNode(original.get(name).body);copied.set(name,expression);return expression;}
function originalLength(x){if(x.kind==='bytes')return x.hex.length/2;if(x.kind==='call')return fixture(x.function.name).length;return x.arguments.reduce((length,value)=>length+originalLength(value),0);}
function originalPrefix(x,length){if(length===originalLength(x))return originalNode(x);if(x.kind==='bytes')return raw(Buffer.from(x.hex,'hex').subarray(0,length));if(x.kind==='call')return originalPrefix(original.get(x.function.name).body,length);const leftLength=originalLength(x.arguments[0]);return length<=leftLength?originalPrefix(x.arguments[0],length):appendExpression(originalNode(x.arguments[0]),originalPrefix(x.arguments[1],length-leftLength));}
// Only semantic fixture boundaries are reusable chunks. The reducer corpus also
// contains small fixtureLiteral implementation helpers; matching those against
// entire messages turns repeated bytes into an unbounded recursive split chain.
for(const name of ['fixtureMaximumBody','fixtureMaximumMessages','fixtureMaximumMembers',
  'fixturePendingMembers','fixtureMaximumSeen','fixtureControlSeen'])
  shared.push({bytes:fixture(name),expression:originalExpression(name)});
shared.push({bytes:postMessages.subarray(0,255*4162),expression:originalPrefix(original.get('fixtureMaximumMessages').body,255*4162)});
// Preserve original compact maximum-body/message structure and reuse the exact
// large journal row prefix across all structural maximum-boundary vectors.
shared.push({bytes:max.head.subarray(38),expression:raw(max.head.subarray(38))});
shared.sort((a,b)=>b.bytes.length-a.bytes.length);
function modeled(bytes){for(const item of shared){const at=bytes.indexOf(item.bytes);if(at<0)continue;const pieces=[];if(at)pieces.push(modeled(bytes.subarray(0,at)));pieces.push(item.expression);if(at+item.bytes.length<bytes.length)pieces.push(modeled(bytes.subarray(at+item.bytes.length)));return pieces.reduce(appendExpression);}return raw(bytes);}
for(const {id,request,response} of vectors){for(const [prefix,bytes] of [['request',request],['response',response]])declarations.push({kind:'definition',name:prefix+id,parameters:[],result:{kind:'bytes'},body:modeled(bytes)});declarations.push({kind:'definition',name:'probe'+id,parameters:[],result:{kind:'bool'},axioms:['Classical.choice','Quot.sound','propext'],body:{kind:'primitive',operation:'equal',result:{kind:'bool'},arguments:[{kind:'call',function:{module:'Foundation.Browser.V1.WorkspaceJournal',name:'workspaceJournalBytes'},arguments:[call('request'+id)]},call('response'+id)]}});}
// Inline single-use append nodes; retain shared literal chunks as small named data.
const uses=new Map(),byName=new Map(declarations.map(d=>[d.name,d]));
function countUses(v){if(v&&typeof v==='object'){if(v.kind==='call')uses.set(v.function.name,(uses.get(v.function.name)||0)+1);for(const x of Object.values(v))countUses(x);}}
for(const d of declarations)countUses(d.body);
const single=name=>name.startsWith('fixtureData')&&uses.get(name)===1&&byName.get(name)?.body.kind==='primitive';
function inline(v){if(Array.isArray(v))return v.map(inline);if(v&&typeof v==='object'){if(v.kind==='call'&&single(v.function.name))return inline(byName.get(v.function.name).body);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,inline(x)]));}return v;}
const emitted=declarations.filter(d=>!single(d.name)).map(d=>({...d,body:inline(d.body)}));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function history(post=false){
  const before=post?postBefore:max.state,after=post?postAfter:max.nextState;
  const memberBytes=before.readUInt16BE(101),messageBytes=before.readUIntBE(103,3);
  const afterMembers=after.readUInt16BE(101),afterMessages=after.readUIntBE(103,3);
  const seen=after.subarray(108+afterMembers+afterMessages),events=[];
  if(seen.length!==1024*32||memberBytes!==(post?63:62)*33||messageBytes!==(post?255:256)*4162)throw Error('closed maximum history fixture');
  function event(action,body){const sequence=events.length,bytes=Buffer.alloc(134+body.length);bytes[0]=1;bytes[1]=action;genesis.event.subarray(2,34).copy(bytes,2);seen.subarray(sequence*32,(sequence+1)*32).copy(bytes,34);if(sequence)seen.subarray((sequence-1)*32,sequence*32).copy(bytes,66);genesis.event.subarray(98,130).copy(bytes,98);bytes.writeUInt16BE(sequence,130);bytes.writeUInt16BE(body.length,132);body.copy(bytes,134);events.push(envelope(bytes));}
  event(0,empty);for(let i=0;i<(post?255:256);i++)event(4,fixture('fixtureMaximumBody'));
  const initialMemberBytes=post?memberBytes-33:memberBytes;
  for(let at=108;at<108+initialMemberBytes;at+=33)event(1,before.subarray(at,at+32));
  const temporary=post?Buffer.from('0000000000000000000000000000000000000000000000000000000000000fa0','hex'):max.event.subarray(134);
  for(let i=0;i<352;i++){event(1,temporary);event(3,temporary);}
  if(post)event(1,before.subarray(108+initialMemberBytes,140+initialMemberBytes));
  event(post?4:1,post?fixture('fixtureMaximumBody'):temporary);if(events.length!==1024)throw Error('complete history ledger');
  const head=concat([0x50,0x57,0x4a,1],genesis.event.subarray(2,34),u16(1024),...events.flatMap(bytes=>[bytes.subarray(167,199),sha(bytes)]));
  return 'Target\t'+head.toString('hex')+'\t'+after.toString('hex')+'\n'+events.map((bytes,index)=>'Event'+index+'\t'+sha(bytes).toString('hex')+'\t'+bytes.toString('hex')+'\n').join('');
}
if(process.argv[2]==='--history'||process.argv[2]==='--history-post')process.stdout.write(history(process.argv[2]==='--history-post'));
else if(process.argv[2]==='--tsv')process.stdout.write(vectors.map(v=>v.id+'\t'+v.request.toString('hex')+'\t'+v.response.toString('hex')+'\n').join(''));
else process.stdout.write(toNotation('\\begin{lexlean}{Foundation.Browser.V1.WorkspaceJournalCorpus}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\importmodule{Foundation.Browser.V1.WorkspaceJournal}\n\\title{Boolean}\n\\begin{semanticmodule}\n\\semanticdata{'+JSON.stringify(canonical({declarations:emitted,spec:'lexlean/semantic-module/2'}))+'}\n\\end{semanticmodule}\n\\end{lexlean}\n'));
