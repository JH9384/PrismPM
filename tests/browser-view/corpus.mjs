// Independent literal expectations; framing builders below do not run the model.
import { toNotation } from '../../scripts/semantic-source.mjs';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
export const H=(hex)=>Buffer.from(hex,'hex'),U=value=>Buffer.from([value]);
export const C=(...values)=>Buffer.concat(values);
export function E16(value){const out=Buffer.alloc(2);out.writeUInt16BE(value);return out;}
export function E24(value){const out=Buffer.alloc(3);out.writeUIntBE(value,0,3);return out;}
export const S=Buffer.alloc(32,1),W=Buffer.alloc(32,2),D=Buffer.alloc(32,3),P=Buffer.alloc(32,4),Z=Buffer.alloc(32),EMPTY=Buffer.alloc(0);
export function state({session=S,workspace=Z,serial=0,phase=0,table=0,kind=0,pending=EMPTY,page=EMPTY,status=0}={}){
 return C(H('50564901'),session,workspace,E16(serial),U(phase),U(table),U(kind),E16(pending.length),pending,E24(page.length),page,U(status));
}
export const req=(operation,st,event=EMPTY)=>C(U(operation),E24(st.length),st,event);
export const success=(st,effect=EMPTY)=>C(U(0),E24(st.length),st,E16(effect.length),effect);
export const effect=({session=S,serial=1,kind=0,workspace=W,table=0,payload=EMPTY}={})=>C(session,E16(serial),U(kind),workspace,U(table),E16(payload.length),payload);
export const completion=({session=S,serial=1,kind=0,outcome=0,payload=EMPTY}={})=>C(session,E16(serial),U(kind),U(outcome),E24(payload.length),payload);
export const cursor=({session=S,principal=P,workspace=W,head=D,table=0,offset=16}={})=>C(H('50514301'),session,principal,workspace,head,U(table),E16(offset));
export const page=({table=0,workspace=W,head=D,total=1,offset=0,count=1,cursor:next=EMPTY,rows=C(P,U(0))}={})=>C(U(0),U(table),workspace,head,E16(total),E16(offset),U(count),E16(next.length),next,E24(rows.length),rows);
const ready=()=>state({workspace:W,serial:1});
const pending=({table=0,kind=0,payload=EMPTY,serial=1}={})=>state({workspace:W,serial,phase:1,table,kind,pending:payload});
const changed=(source,offset,bytes)=>{const result=Buffer.from(source);result.set(bytes,offset);return result;};
export const rows=(count,offset=0)=>C(...Array.from({length:count},(_,i)=>C(Buffer.alloc(32,offset+i+1),U(offset+i===0?0:1))));
export const messages=(count,size=1)=>C(...Array.from({length:count},(_,i)=>C(Buffer.alloc(32,i+1),P,E16(size),Buffer.alloc(size,65+i%26))));
export function corpus(){
 const out=[];const add=(id,request,response)=>{if(out.some(v=>v.id===id))throw Error(id);out.push({id,request,response});};
 const error=(id,request,code)=>add(id,request,U(code));
 const base=state(),rd=ready(),pd=pending(),one=page(),msgEmpty=page({table:1,total:0,count:0,rows:EMPTY});
 add('Initialize',C(U(0),S),success(base));
 error('InitializeZeroSession',C(U(0),Z),1);error('InitializeShort',C(U(0),S.subarray(1)),1);error('InitializeTrailing',C(U(0),S,U(0)),1);
 error('EmptyRequest',EMPTY,1);error('TruncatedFrame',H('010000'),1);error('OverAllocation',Buffer.alloc(133729),1);
 error('ExactAllocationCap',Buffer.alloc(133728),1);
 error('StateLengthOverCap',C(U(1),E24(66883),Buffer.alloc(66883)),1);error('StateLengthTruncated',C(U(1),E24(base.length+1),base),1);
 error('UnknownOperation',req(4,base),14);error('InvalidStateMagic',req(1,changed(base,0,U(0)),U(6)),2);
 error('StateZeroSession',req(1,changed(base,4,Z),U(6)),2);error('StateUnknownPhase',req(1,changed(base,70,U(4)),U(6)),2);
 error('StateUnknownTable',req(1,changed(base,71,U(2)),U(6)),2);error('StateUnknownKind',req(1,changed(base,72,U(3)),U(6)),2);
 error('StateStatusOverBound',req(1,changed(base,78,U(5)),U(6)),2);error('StateTrailing',req(1,C(base,U(0)),U(6)),2);
 error('EmptyIntent',req(1,base),3);error('UnknownIntent',req(1,base,U(7)),3);error('IntentTrailing',req(1,base,H('0600')),3);
 error('SelectZero',req(1,base,C(U(0),Z)),3);error('SelectShort',req(1,base,C(U(0),W.subarray(1))),3);
 add('Select',req(1,base,C(U(0),W)),success(pd,effect()));
 for(const [id,action,table]of[['Members',1,0],['Messages',2,1]])add(id,req(1,rd,U(action)),success(pending({serial:2,table}),effect({serial:2,table})));
 for(const action of[1,2,3,4,5])error('NoSelection'+action,req(1,base,action===4?H('0400'):U(action)),8);
 error('NextWithoutPage',req(1,rd,U(3)),9);error('NextFinalPage',req(1,state({workspace:W,serial:1,page:one}),U(3)),9);
 add('QueryMemberComplete',req(2,pd,completion({payload:one})),success(state({workspace:W,serial:1,page:one})));
 add('QueryEmptyMessages',req(2,pending({table:1}),completion({payload:msgEmpty})),success(state({workspace:W,serial:1,table:1,page:msgEmpty})));
 for(const outcome of[1,4])add('QueryFailure'+outcome,req(2,pd,completion({outcome})),success(state({workspace:W,serial:1,status:outcome})));
 for(const outcome of[2,3,5,6])error('QueryInvalidOutcome'+outcome,req(2,pd,completion({outcome})),outcome===6?1:12);
 error('QueryFailureHasPayload',req(2,pd,completion({outcome:1,payload:U(1)})),12);
 error('WrongSession',req(2,pd,completion({session:D,payload:one})),11);error('WrongCounter',req(2,pd,completion({serial:2,payload:one})),11);
 error('WrongKind',req(2,pd,completion({kind:1,payload:one})),11);error('DuplicateCompletion',req(2,state({workspace:W,serial:1,page:one}),completion({payload:one})),10);
 error('CompletionTruncated',req(2,pd,completion({payload:one}).subarray(1)),1);error('CompletionTrailing',req(2,pd,C(completion({payload:one}),U(0))),1);
 for(const phase of[0,1,2,3]){const st=phase===0?rd:phase===1?pd:phase===2?state({workspace:W,serial:1,phase:2,status:3}):state({phase:3,serial:1});
  add('ClosePhase'+phase,req(1,st,U(6)),success(state({phase:3,serial:1})));
 }
 error('ClosedIntent',req(1,state({phase:3,serial:1}),C(U(0),W)),6);error('ClosedLateCompletion',req(2,state({phase:3,serial:1}),completion({payload:one})),10);
 error('BusyIntent',req(1,pd,U(1)),4);error('BusySelection',req(1,pd,C(U(0),D)),4);
 error('ReplayRejectsCommand',req(1,state({workspace:W,serial:1,phase:2,status:3}),H('0400')),5);
 error('ReplayRejectsSelection',req(1,state({workspace:W,serial:1,phase:2}),C(U(0),D)),5);
 error('CounterExhausted',req(1,state({workspace:W,serial:65535}),U(1)),7);
 add('CounterLastAllocated',req(1,state({workspace:W,serial:65534}),U(1)),success(pending({serial:65535}),effect({serial:65535})));
 add('CounterExhaustedClose',req(1,state({workspace:W,serial:65535}),U(6)),success(state({phase:3,serial:65535})));
 for(let action=0;action<5;action++){
  const body=action===0?EMPTY:action===4?Buffer.from('hello ☃'):P,payload=C(U(action),body);
  add('Command'+action,req(1,rd,C(U(4),payload)),success(pending({serial:2,kind:1,payload}),effect({serial:2,kind:1,payload})));
  for(let outcome=0;outcome<6;outcome++)add('Command'+action+'Outcome'+outcome,req(2,pending({kind:1,payload}),completion({kind:1,outcome})),success(state({workspace:W,serial:1,phase:[0,2,3,4,5].includes(outcome)?2:0,status:outcome===5?1:outcome})));
 }
 for(const [id,payload]of[['GenesisBody',H('0000')],['ZeroMember',C(U(1),Z)],['ShortMember',C(U(2),P.subarray(1))],['LongMember',C(U(3),P,U(0))],['EmptyPost',U(4)],['InvalidUtf8',H('04ff')],['LongPost',C(U(4),Buffer.alloc(4097,65))],['UnknownCommand',U(5)]])error(id,req(1,rd,C(U(4),payload)),3);
 const maxPost=C(U(4),Buffer.alloc(4096,65));add('MaximumPost',req(1,rd,C(U(4),maxPost)),success(pending({serial:2,kind:1,payload:maxPost}),effect({serial:2,kind:1,payload:maxPost})));
 error('WriteOutcomePayload',req(2,pending({kind:1,payload:U(0)}),completion({kind:1,payload:U(0)})),12);
 for(const phase of[0,2])add('RefreshPhase'+phase,req(1,state({workspace:W,serial:1,phase,status:phase===2?3:0}),U(5)),success(pending({kind:2,serial:2}),effect({kind:2,serial:2})));
 for(const outcome of[0,1,4])add('RefreshOutcome'+outcome,req(2,pending({kind:2}),completion({kind:2,outcome})),success(state({workspace:W,serial:1,phase:outcome===0?0:2,status:outcome})));
 for(const outcome of[2,3,5])error('RefreshInvalidOutcome'+outcome,req(2,pending({kind:2}),completion({kind:2,outcome})),12);
 // Every legal maximum-table offset, including the full final page, is literal.
 for(const table of[0,1])for(let offset=0;offset<(table===0?64:256);offset+=16){
  const total=table===0?64:256,row=table===0?rows(16,offset):messages(16,offset===0?4096:1),next=offset+16<total?cursor({table,offset:offset+16}):EMPTY;
  const pg=page({table,total,offset,count:16,cursor:next,rows:row}),pn=offset?cursor({table,offset}):EMPTY;
  add('Page'+table+'Offset'+offset,req(2,pending({table,payload:pn}),completion({payload:pg})),success(state({workspace:W,serial:1,table,page:pg})));
  if(next.length)add('Next'+table+'Offset'+offset,req(1,state({workspace:W,serial:1,table,page:pg}),U(3)),success(pending({table,serial:2,payload:next}),effect({table,serial:2,payload:next})));
 }
 const sixteen=page({total:17,count:16,cursor:cursor(),rows:rows(16)});
 const badPages=[['PageWrongWorkspace',changed(one,2,D)],['PageZeroHead',changed(one,34,Z)],['PageUnknownTable',changed(one,1,U(2))],['PageWrongTable',msgEmpty],
 ['PageTrailing',C(one,U(0))],['PageTruncated',one.subarray(0,-1)],['PageWrongCount',changed(one,70,U(2))],['PageCountSeventeen',changed(one,70,U(17))],
 ['PageMemberTotalZero',page({total:0,count:0,rows:EMPTY})],['PageMemberTotalOver',page({total:65,count:16,cursor:cursor(),rows:rows(16)})],
 ['PageMemberZeroId',page({rows:C(Z,U(0))})],['PageOwnerWrongRole',page({rows:C(P,U(1))})],['PageExtraMember',page({rows:C(P,U(0),P,U(1))})],
 ['PageDuplicateMembers',page({total:3,count:3,rows:C(P,U(0),D,U(1),D,U(2))})],['PageDuplicateOwner',page({total:3,count:3,rows:C(P,U(0),P,U(1),D,U(2))})],
 ['PageMissingContinuation',page({total:17,count:16,rows:rows(16)})],['PageUnexpectedContinuation',page({cursor:cursor()})],
 ['PageCursorWrongHead',page({total:17,count:16,cursor:cursor({head:P}),rows:rows(16)})],['PageCursorWrongOffset',page({total:33,count:16,cursor:cursor({offset:32}),rows:rows(16)})],
 ['PageCursorWrongWorkspace',page({total:17,count:16,cursor:cursor({workspace:P}),rows:rows(16)})],['PageCursorZeroSession',page({total:17,count:16,cursor:cursor({session:Z}),rows:rows(16)})]];
 for(const [id,pg]of badPages)error(id,req(2,pd,completion({payload:pg})),13);
 const descending=page({total:3,count:3,rows:C(P,U(0),D,U(1),W,U(2))});
 add('PageGrantInsertionOrder',req(2,pd,completion({payload:descending})),success(state({workspace:W,serial:1,page:descending})));
 const queryFixtures=JSON.parse(readFileSync(new URL('./query-fixtures.json',import.meta.url)));
 for(const fixture of queryFixtures.fixtures){const pg=H(fixture.response_hex),workspace=pg.subarray(2,34),prior=H(fixture.requested_cursor_hex);
  add(fixture.id,req(2,state({workspace,serial:1,phase:1,pending:prior}),completion({payload:pg})),success(state({workspace,serial:1,page:pg})));
 }
 const at16=page({table:1,total:48,offset:16,count:16,cursor:cursor({table:1,offset:32}),rows:messages(16)}),pd16=pending({table:1,payload:cursor({table:1,offset:16})});
 error('ContinuationWrongHead',req(2,pd16,completion({payload:page({table:1,head:P,total:32,offset:16,count:16,rows:messages(16)})})),13);
 error('ContinuationWrongOffset',req(2,pd16,completion({payload:page({table:1,total:16,count:16,rows:messages(16)})})),13);
 error('ContinuationChangedSession',req(2,pd16,completion({payload:changed(at16,77,D)})),13);
 error('ContinuationChangedPrincipal',req(2,pd16,completion({payload:changed(at16,109,D)})),13);
 for(const [id,row]of[['MessageZeroId',C(Z,P,E16(1),U(65))],['MessageZeroAuthor',C(P,Z,E16(1),U(65))],['MessageEmpty',C(P,P,E16(0))],['MessageInvalidUtf8',C(P,P,E16(1),U(255))],['MessageLengthTruncated',C(P,P,E16(2),U(65))],['MessageOverBody',C(P,P,E16(4097),Buffer.alloc(4097,65))]])error(id,req(2,pending({table:1}),completion({payload:page({table:1,rows:row})})),13);
 error('MessageTotalOver',req(2,pending({table:1}),completion({payload:page({table:1,total:257,count:16,cursor:cursor({table:1}),rows:messages(16)})})),13);
 error('EmptyFinalOffset',req(2,pending({table:1,payload:cursor({table:1})}),completion({payload:page({table:1,total:16,offset:16,count:0,rows:EMPTY})})),13);
 error('StatePendingPage',req(1,state({workspace:W,serial:1,phase:1,page:one}),U(6)),2);
 error('StateReadyPending',req(1,state({workspace:W,serial:1,pending:cursor()}),U(6)),2);
 error('StateReplayPage',req(1,state({workspace:W,serial:1,phase:2,page:one}),U(6)),2);
 error('StateClosedSelection',req(1,state({workspace:W,serial:1,phase:3}),U(6)),2);
 error('StatePageWithError',req(1,state({workspace:W,serial:1,page:one,status:1}),U(6)),2);
 // Exact typed presentation bytes, never interpolated markup.
 const presentation=({phase=0,status=0,table=0,controls=119,focus=0,live=0,workspace=W,head=Z,total=0,offset=0,count=0,next=0,rows=EMPTY}={})=>C(H('0050564e01'),U(phase),U(status),U(table),U(controls),U(focus),U(live),workspace,head,E16(total),E16(offset),U(count),U(next),E24(rows.length),rows);
 add('PresentationInitial',req(3,base),presentation({workspace:Z,controls:65}));
 add('PresentationPending',req(3,pd),presentation({phase:1,controls:64,live:1}));
 add('PresentationMember',req(3,state({workspace:W,serial:1,page:one})),presentation({focus:1,live:1,head:D,total:1,count:1,rows:C(P,U(0))}));
 add('PresentationNext',req(3,state({workspace:W,serial:1,page:sixteen})),presentation({controls:127,focus:1,live:1,head:D,total:17,count:16,next:1,rows:rows(16)}));
 add('PresentationReplay',req(3,state({workspace:W,serial:1,phase:2,status:3})),presentation({phase:2,status:3,controls:96,focus:1,live:2}));
 add('PresentationCommittedNeedsReplay',req(3,state({workspace:W,serial:1,phase:2})),presentation({phase:2,controls:96,focus:1,live:1}));
 add('PresentationClosed',req(3,state({phase:3,serial:1})),presentation({phase:3,workspace:Z,controls:0}));
 add('PresentationCounterExhausted',req(3,state({workspace:W,serial:65535})),presentation({controls:64}));
 const text=Buffer.from('<script>alert("x")</script> & ☃'),row=C(P,D,E16(text.length),text),pg=page({table:1,rows:row});
 add('PresentationTextNotMarkup',req(3,state({workspace:W,serial:1,table:1,page:pg})),presentation({table:1,focus:1,live:1,head:D,total:1,count:1,rows:row}));
 const largestRows=messages(16,4096),largestPage=page({table:1,total:256,count:16,cursor:cursor({table:1}),rows:largestRows});
 add('PresentationMaximumPage',req(3,state({workspace:W,serial:1,table:1,page:largestPage})),presentation({table:1,controls:127,focus:1,live:1,head:D,total:256,count:16,next:1,rows:largestRows}));
 error('PresentationTrailingEvent',req(3,rd,U(0)),1);
 return out;
}

export function semanticCorpus(){
 const definitions=[],literals=new Map();
 const B={kind:'bytes'},T={kind:'bool'},call=name=>({kind:'call',function:{name},arguments:[]});
 function definition(name,result,body,axioms=[]){definitions.push({kind:'definition',name,parameters:[],result,body,axioms});}
 function bytes(value){if(value.length<=256){const hex=value.toString('hex');if(!literals.has(hex)){const name='literal'+literals.size;literals.set(hex,name);definition(name,B,{kind:'bytes',hex});}return call(literals.get(hex));}
  const half=Math.floor(value.length/512)*256||256;return {kind:'primitive',operation:'append',result:B,arguments:[bytes(value.subarray(0,half)),bytes(value.subarray(half))]};}
 for(const item of corpus()){
  definition('request'+item.id,B,bytes(item.request));definition('response'+item.id,B,bytes(item.response));
  definition('probe'+item.id,T,{kind:'call',function:{module:'Foundation.Browser.V1.Workspace',name:'workspaceBytesEqual'},arguments:[{kind:'call',function:{module:'Foundation.View.Workspace.V1.Interaction',name:'workspaceInteractionBytes'},arguments:[call('request'+item.id)]},call('response'+item.id)]},['Classical.choice','Quot.sound','propext']);
 }
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return toNotation('\\begin{lexlean}{Foundation.View.Workspace.V1.Corpus}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\useglossary{lexlean.std.nat@1.2.0}\n\\importmodule{Foundation.View.Workspace.V1.Interaction}\n\\importmodule{Foundation.Browser.V1.Workspace}\n\\title{Boolean}\n\\begin{semanticmodule}\n\\semanticdata{'+JSON.stringify(canonical({declarations:definitions,spec:'lexlean/semantic-module/2'}))+'}\n\\end{semanticmodule}\n\\end{lexlean}\n');
}
