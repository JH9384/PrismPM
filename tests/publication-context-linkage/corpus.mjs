// Independent private-wire expectations, never producer authentication facts.
import assert from 'node:assert/strict';
import {encode, positional as admission, fixture as admissionFixture, declarationPreimage, bytes, clone} from '../publication-admission/corpus.mjs';
export {encode,bytes,clone};
const fields=spec=>spec.split(' ').map(field=>field.split(':'));
export const records={
 Member:fields('module:s name:s'),Service:fields('id:s components:s[]'),
 Requirement:fields('obligation:n member:Member requirement:RequirementValue'),
 Closure:fields('system:Member target:s declaration:Declaration services:Service[] controls:s[] requirements:Requirement[]'),
 Record:fields('id:s digest:b'),File:fields('path:s digest:b'),
 SourceLink:fields('snapshot:b source:b semantic:b compiler:b closureMember:Member moduleSource:b systemMember:Member system:b target:s'),
 Capture:fields('sourceLink:SourceLink components:Record[] controls:Record[] provenance:b dependencies:Record[] sdkLock:b standardsLock:b lexleanBuildManifest:b lexleanAttestation:b buildManifest:b verificationManifest:b verificationFiles:File[] browserFiles:File[] releaseValidation:b oracleAttestations:File[]'),
};
export function positional(type,value){
 if(type.endsWith('[]'))return value.map(item=>positional(type.slice(0,-2),item));
 if(['s','n','b'].includes(type))return value;
 if(type==='Declaration')return admission(type,value);
 if(type==='RequirementValue'){
  const {kind}=value;
  if(kind===0)return [0,positional('Member',value.theorem)];
  if(kind===1)return [1,value.oracle,selector(value.input),value.suite];
  assert.equal(kind,2);return [2,value.criterion,value.subject];
 }
 assert.ok(records[type],type);return records[type].map(([field,type])=>positional(type,value[field]));
}
function selector(value){
 if(value.kind===0)return [0,value.path];if(value.kind===1)return [1,positional('Member',value.member)];assert.equal(value.kind,2);return [2];
}
const member=(module,name)=>({module,name});
export function fixture(){
 const declaration=admissionFixture(3).declaration;
 declaration.obligations.forEach((row,index)=>{row.moment=index===2?1:0;row.assurance=[0,1,5][index];});
 const closure={system:member('Release','systemModelB'),target:'pages',declaration,
  services:[{id:'calculator',components:['app','view']}],controls:['artifact','proof'],requirements:[
   {obligation:1,member:member('Publication','proof'),requirement:{kind:0,theorem:member('Release','releaseBSystemReleaseReady')}},
   {obligation:2,member:member('Publication','oracle'),requirement:{kind:1,oracle:'fixture-suite',input:{kind:2},suite:bytes(32,52)}},
   {obligation:3,member:member('Publication','assessment'),requirement:{kind:2,criterion:'Inspect exact fixture',subject:'Fixture only'}},
  ]};
 const sourceLink={...Object.fromEntries(['snapshot','source','semantic','compiler','moduleSource','system'].map((field,i)=>[field,bytes(32,60+i)])),
  closureMember:member('Publication','publicationClosure'),systemMember:clone(closure.system),target:closure.target};
 const capture={sourceLink,components:['app','view'].map((id,i)=>({id,digest:bytes(32,70+i)})),
  controls:['artifact','proof'].map((id,i)=>({id,digest:bytes(32,80+i)})),provenance:bytes(32,90),dependencies:[{id:'https://example.invalid/source',digest:bytes(32,91)}],
  ...Object.fromEntries(['sdkLock','standardsLock','lexleanBuildManifest','lexleanAttestation','buildManifest','verificationManifest','releaseValidation'].map((field,i)=>[field,bytes(32,100+i)])),
  verificationFiles:[{path:'lexlean-attestation.json',digest:bytes(32,103)},{path:'manifest.json',digest:bytes(32,105)}],
  browserFiles:[{path:'index.html',digest:bytes(32,120)}],oracleAttestations:[{path:'fixture.intoto.json',digest:bytes(32,121)}]};
 return {closure,capture};
}
export const request=({closure,capture})=>encode([1,0,positional('Closure',closure),positional('Capture',capture)]);
export function expected({closure:c,capture:x}){
 const source=positional('SourceLink',x.sourceLink),requirements=positional('Requirement[]',c.requirements);
 const bodies={
  services:[source,positional('Service[]',c.services),positional('Record[]',x.components)],
  controls:[source,c.controls,positional('Record[]',x.controls),x.standardsLock,requirements],
  dependencies:[x.provenance,positional('Record[]',x.dependencies)],
  compiler:[x.sdkLock,x.lexleanBuildManifest,x.lexleanAttestation,x.buildManifest,x.verificationManifest],
  runtime:[x.verificationManifest,positional('File[]',x.verificationFiles),positional('File[]',x.browserFiles)],
  oracles:[source,requirements,x.standardsLock,x.sdkLock,x.releaseValidation,positional('File[]',x.oracleAttestations)],
 };
 const preimages=[declarationPreimage(c.declaration),...Object.entries(bodies).map(([name,body])=>Buffer.concat([Buffer.from('prismpm/publication-'+name+'-closure/1\0'),encode(body)]))];
 return encode([1,0,...preimages]);
}
const error=code=>encode([1,1,code]),malformed=code=>encode([1,2,code]);
export function corpus(){
 const rows=[];
 const add=(id,input,output)=>{assert.ok(!rows.some(row=>row.id===id),id);rows.push({id,request:input,response:output});};
 const valid=(id,mutate=()=>{})=>{const value=fixture();mutate(value);add(id,request(value),expected(value));};
 const invalid=(id,code,mutate)=>{const value=fixture();mutate(value);add(id,request(value),error(code));};
 valid('CompleteConditionalCapture');
 valid('DependencyUriMaximum',x=>{x.capture.dependencies[0].id='https://example.invalid/'+ 'a'.repeat(2048-24);});
 {const x=fixture();x.capture.dependencies[0].id='https://example.invalid/'+ 'a'.repeat(2049-24);
  add('DependencyUriOneOver',request(x),malformed(6));}
 for(const count of [0,1,255,256,257,512]) valid('WriterFileBoundary'+count,x=>{
  x.capture.browserFiles=Array.from({length:count},(_,index)=>({path:'file'+String(index).padStart(4,'0'),digest:bytes()}));
 });
 {const x=fixture();x.capture.browserFiles[0].path='a'.repeat(2049);x.capture.sdkLock=bytes(31);
  add('WriterFramingPrecedesMetadata',request(x),malformed(6));}
 {const x=fixture();x.capture.browserFiles[0].path='a'.repeat(2049);const input=request(x);
  add('WriterEarlierLimitPrecedesTailTruncation',input.subarray(0,-1),malformed(6));}
 for(const name of ['snapshot','source','semantic','compiler','moduleSource','system']){
  valid('ChangedSource'+name,x=>x.capture.sourceLink[name]=bytes(32,255));
  invalid('ShortSource'+name,0,x=>x.capture.sourceLink[name]=bytes(31));
 }
 for(const name of ['provenance','sdkLock','standardsLock','lexleanBuildManifest','lexleanAttestation','buildManifest','releaseValidation']){
  valid('ChangedCapture'+name,x=>x.capture[name]=bytes(32,254));
  invalid('ShortCapture'+name,0,x=>x.capture[name]=bytes(31));
 }
 valid('ChangedManifestCoherently',x=>{x.capture.verificationManifest=bytes(32,253);x.capture.verificationFiles[1].digest=bytes(32,253);});
 for(const kind of ['components','controls','dependencies','verificationFiles','browserFiles','oracleAttestations']){
  valid('ChangedRecord'+kind,x=>x.capture[kind][0].digest=bytes(32,252));
  invalid('ShortRecord'+kind,0,x=>x.capture[kind][0].digest=bytes(31));
  invalid('DuplicateRecord'+kind,0,x=>x.capture[kind].push(clone(x.capture[kind][0])));
  invalid('EmptyRecordId'+kind,0,x=>x.capture[kind][0][kind.endsWith('Files')||kind==='oracleAttestations'?'path':'id']='');
 }
 valid('NonAsciiUTF8ByteOrder',x=>{x.closure.services[0].components=['z','é'];x.capture.components[0].id='z';x.capture.components[1].id='é';});
 valid('InterleavedPartition',x=>{x.capture.components=['a','b','c','d'].map(id=>({id,digest:bytes()}));x.closure.services=[{id:'one',components:['a','c']},{id:'two',components:['b','d']}];});
 const bucketPartition=x=>{
  const ids=Array.from({length:512},(_,index)=>'component'+String(index).padStart(3,'0'));
  x.capture.components=ids.map(id=>({id,digest:bytes()}));
  x.closure.services=[{id:'even',components:ids.filter((_,index)=>index%2===0)},
   {id:'odd',components:ids.filter((_,index)=>index%2===1)}];
 };
 valid('InterleavedBucketBoundaryPartition',bucketPartition);
 for(const [name,at,replacement] of [['First',0,'component000'],['Boundary',127,'component256'],['Last',255,'component510']])
  invalid('DuplicateAcross'+name+'Bucket',2,x=>{bucketPartition(x);x.closure.services[1].components[at]=replacement;});
 invalid('ForeignFinalBucketReference',2,x=>{bucketPartition(x);x.closure.services[1].components[255]='component512';});
 invalid('MissingFinalBucketReference',2,x=>{bucketPartition(x);x.closure.services[1].components.pop();});
 valid('EmptyControlInventory',x=>{x.closure.controls=[];x.capture.controls=[];});
 valid('SelectedBuildFile',x=>x.closure.requirements[1].requirement.input={kind:0,path:'view/browser/index.html'});
 valid('SelectedSourceMember',x=>x.closure.requirements[1].requirement.input={kind:1,member:member('Release','systemModelB')});
 valid('ChangedCriterion',x=>x.closure.requirements[2].requirement.criterion='A different exact fixture criterion');
 valid('ChangedAuthority',x=>x.closure.declaration.obligations[1].authority=bytes(32,247));
 valid('ChangedScope',x=>x.closure.declaration.obligations[1].scope=bytes(32,248));
 invalid('EmptyServices',0,x=>x.closure.services=[]);
 invalid('EmptyServiceComponents',0,x=>x.closure.services[0].components=[]);
 invalid('DuplicateService',0,x=>x.closure.services.push(clone(x.closure.services[0])));
 invalid('UnsortedComponentReferences',0,x=>x.closure.services[0].components.reverse());
 invalid('DuplicateControlReference',0,x=>x.closure.controls.push('proof'));
 invalid('SystemReferenceMismatch',1,x=>x.capture.sourceLink.systemMember.name='systemModelA');
 invalid('TargetReferenceMismatch',1,x=>x.capture.sourceLink.target='different');
 invalid('MissingComponent',2,x=>x.closure.services[0].components=['app']);
 invalid('ForeignComponent',2,x=>x.closure.services[0].components=['app','foreign']);
 invalid('DuplicatePartitionComponent',2,x=>x.closure.services=[{id:'a',components:['app']},{id:'b',components:['app']}]);
 invalid('MissingControl',2,x=>x.closure.controls=['artifact']);
 invalid('ForeignControl',2,x=>x.closure.controls=['artifact','unknown']);
 invalid('MissingManifestRecord',2,x=>x.capture.verificationFiles.pop());
 invalid('ChangedManifestRecord',2,x=>x.capture.verificationFiles[1].digest=bytes(32,250));
 invalid('MissingRequirement',3,x=>x.closure.requirements.pop());
 invalid('WrongObligationId',3,x=>x.closure.requirements[2].obligation=4);
 invalid('WrongAssuranceKind',3,x=>x.closure.requirements[0].requirement=clone(x.closure.requirements[1].requirement));
 invalid('DuplicateRequirementMember',3,x=>x.closure.requirements[2].member=clone(x.closure.requirements[0].member));
 invalid('OversizedComponentIdentity',0,x=>x.capture.components[1].id='z'.repeat(129));
 invalid('OversizedControlIdentity',0,x=>x.capture.controls[1].id='z'.repeat(129));
 invalid('MetadataPrecedesSource',0,x=>{x.capture.sourceLink.target='different';x.capture.sdkLock=bytes(31);});
 invalid('SourcePrecedesPartition',1,x=>{x.capture.sourceLink.target='different';x.closure.services[0].components=['app'];});
 invalid('PartitionPrecedesRequirement',2,x=>{x.closure.services[0].components=['app'];x.closure.requirements.pop();});
 for(const [name,path,limit]of[
  ['Member',['closure','system','name'],2048],['Target',['closure','target'],128],['Service',['closure','services',0,'id'],128],
  ['Criterion',['closure','requirements',2,'requirement','criterion'],2048],['Subject',['closure','requirements',2,'requirement','subject'],2048],
  ['Oracle',['closure','requirements',1,'requirement','oracle'],128],['File',['capture','browserFiles',0,'path'],2048],
 ]){
  const set=(x,length)=>{const owner=path.slice(0,-1).reduce((v,key)=>v[key],x);owner[path.at(-1)]='a'.repeat(length);if(name==='Member')x.capture.sourceLink.systemMember.name=owner[path.at(-1)];if(name==='Target')x.capture.sourceLink.target=owner[path.at(-1)];};
  valid(name+'ExactByteLimit',x=>set(x,limit));
  if(limit===128)invalid(name+'OneOverByteLimit',0,x=>set(x,limit+1));
  else{const x=fixture();set(x,limit+1);add(name+'OneOverByteLimit',request(x),malformed(6));}
 }
 const complete=request(fixture());
 add('TrailingCBOR',Buffer.concat([complete,Buffer.from([0])]),malformed(8));
 add('TruncatedCBOR',complete.subarray(0,-1),malformed(2));
 add('IndefiniteArray',Buffer.from([0x9f,1,0,0xff]),malformed(4));
 add('NonminimalArray',Buffer.concat([Buffer.from([0x98,4]),complete.subarray(1)]),malformed(5));
 {const hostile=Buffer.from(complete),offset=hostile.indexOf(Buffer.from('Release'));assert.ok(offset>0);hostile[offset]=0xff;add('InvalidUTF8',hostile,malformed(7));}
 add('WrongVersion',encode([2,0,positional('Closure',fixture().closure),positional('Capture',fixture().capture)]),malformed(3));
 return rows;
}
