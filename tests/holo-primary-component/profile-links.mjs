// Independently wrong cross-structure facts in otherwise valid source-composed
// archives. The real executor entry must refuse before opening its vector file.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {requirePreparedComponent,sha} from './compile.mjs';

const zero='0'.repeat(64),wrong='blake3:'+zero;
const sourceChange=(value,change)=>{for(const name of ['model','metadata','provenance'])change(value[name].source);};
export const profileLinkCases=Object.freeze([
  ...['model_content_kappa','guest_content_kappa','capabilities_content_kappa','application_kappa']
    .map(field=>({id:'wrong-'+field.replaceAll('_','-'),expected:field,
      change:value=>{value.provenance[field]=wrong;}})),
  ...['model','metadata','provenance'].map(name=>({id:name+'-source-substitution',expected:'source equality',
    change:value=>{value[name].source.source_id=zero;}})),
  {id:'empty-source-facts',expected:'source facts',change:value=>{
    for(const name of ['model','metadata','provenance'])value[name].source={};}},
  {id:'invalid-proof-digest',expected:'source facts',change:value=>sourceChange(value,source=>{source.exact_proof.attestation='g'.repeat(64);})},
  {id:'module-input-substitution',expected:'module input closure',change:value=>sourceChange(value,source=>{
    source.modules['Foundation.Browser.Application.V1.SessionWire']=zero;})},
  {id:'omitted-source-module',expected:'module input closure',change:value=>sourceChange(value,source=>{
    delete source.modules['Foundation.Holo.V1.PrimaryWire'];})},
  {id:'empty-input-closure',expected:'captured input closure',change:value=>{value.model.captured_inputs={};}},
  {id:'IR-substitution',expected:'IR equality',change:value=>{value.provenance.input_ir_sha256=zero;}},
  {id:'package-substitution',expected:'package closure equality',change:value=>{value.provenance.generated_packages=[];}},
  {id:'empty-package-closures',expected:'package closure equality',change:value=>{
    value.provenance.generated_packages=[];value.model.generated_packages=[];}},
  {id:'foreign-profile',expected:'profile schema',change:value=>{value.model.profile='unregistered';}},
  {id:'false-application-acceptance',expected:'private source entry',change:value=>{value.model.application_acceptance=true;}},
  {id:'missing-provenance-field',expected:'provenance shape',change:value=>{delete value.provenance.guest_content_kappa;}},
  {id:'unknown-metadata-field',expected:'metadata shape',change:value=>{value.metadata.unregistered=true;}},
  {id:'noncanonical-metadata',expected:'metadata shape',change:()=>{},encodeMetadata:bytes=>Buffer.concat([Buffer.from(' '),bytes])},
  {id:'duplicate-provenance-key',expected:'provenance shape',change:()=>{},
    encodeProvenance:bytes=>Buffer.concat([Buffer.from('{"schema":"unregistered",'),bytes.subarray(1)])},
  {id:'wrong-authority-pin',expected:'authority revisions',change:value=>{value.provenance.hologram_live_revision='0'.repeat(40);}},
  {id:'empty-executable-facts',expected:'executable facts',change:value=>{value.model.native={};}},
  {id:'wrong-guest-sha256',expected:'guest SHA-256',change:value=>{value.model.guest_sha256=zero;}},
]);

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));
}
const json=value=>Buffer.from(JSON.stringify(canonical(value)));

export function profileLinkAdversaries(component,owner,oracle){
  requirePreparedComponent(owner);component.verify();
  const root=join(owner.work,'profile-link-negatives');mkdirSync(root);
  const frozen=new Map();let sequence=0;
  const put=(name,bytes)=>{const path=join(root,name);writeFileSync(path,bytes,{flag:'wx'});frozen.set(path,sha(bytes));return path;};
  const unchanged=()=>{
    component.verify();for(const[path,digest]of frozen)assert.equal(sha(readFileSync(path)),digest,'immutable negative profile input');
  };
  const invoke=(operation,args)=>{
    unchanged();const paths=args.map(bytes=>put('argument-'+sequence++,bytes)),results=[];
    for(const standard of[true,false]){
      const output=join(root,'output-'+sequence++);
      assert.equal(owner.runNative(standard,[operation,output,...paths]).trim(),'SOME');
      results.push(readFileSync(output));
    }
    assert.deepEqual(results[0],results[1],'actual native profile-negative composition parity');unchanged();return results[0];
  };
  const identity=bytes=>{
    const path=put('identity-'+sequence++,bytes),result=oracle.call(['identity',path]);
    assert.equal(result.length,bytes.length);assert.match(result.kappa,/^blake3:[a-f0-9]{64}$/);
    assert.equal(result.digest,result.kappa.slice(7));unchanged();return result;
  };
  const base=Object.fromEntries(['model','metadata','provenance'].map(name=>[name,JSON.parse(readFileSync(component.paths[name]))]));
  const guest=readFileSync(component.paths.guest),capabilities=invoke('capabilities',[]);
  const guestId=identity(guest),capabilitiesId=identity(capabilities);
  const manifest=invoke('manifest',[Buffer.from(capabilitiesId.kappa),Buffer.from(guestId.kappa)]);
  const records=[];
  for(const row of profileLinkCases){
    const value=structuredClone(base);row.change(value);
    const model=json(value.model),modelId=identity(model);
    // Keep the actual model address correct except in the case targeting that
    // precise reference; changed model facts must reach the equality check.
    if(row.expected!=='model_content_kappa')value.provenance.model_content_kappa=modelId.kappa;
    const metadata=row.encodeMetadata?.(json(value.metadata))??json(value.metadata);
    const provenance=row.encodeProvenance?.(json(value.provenance))??json(value.provenance);
    const contents=[[capabilitiesId,capabilities],[guestId,guest],[modelId,model]]
      .sort(([a],[b])=>a.kappa<b.kappa?-1:a.kappa>b.kappa?1:0);
    const directory=Buffer.from(JSON.stringify({schema_version:1,primary_layer:0,requires_kappa:capabilitiesId.kappa,
      layers:[{position:0,kind:'wasm',content_kappa:guestId.kappa,entry:'holo_run',contract:'hologram:guest/core-wasm@1',
        architecture:null,surface:null,engine:null}],children:[],blobs:contents.map(([id,bytes])=>({kappa:id.kappa,byte_length:bytes.length}))}));
    const blobs=contents.map(([id,bytes])=>invoke('blob',[Buffer.from(id.kappa),bytes]));
    const body=invoke('body',[manifest,metadata,directory,provenance,...blobs]);
    const archive=invoke('frame',[body,Buffer.from(identity(body).digest,'hex')]);
    const paths=[put(row.id+'.holo',archive),component.paths.guest,put(row.id+'-model.json',model),
      put(row.id+'-metadata.json',metadata),put(row.id+'-provenance.json',provenance)];
    assert.equal(oracle.call(['inspect',paths[0]]).accepted,true,'valid actual upstream framing/content before linkage refusal');
    const absent=join(root,row.id+'-must-not-open-vectors.json');assert.equal(existsSync(absent),false);
    assert.throws(()=>oracle.call(['execute',...paths,absent]),error=>String(error)
      .includes('component profile link mismatch: '+row.expected),
    'the real executor entry must reject the intended cross-structure fact before reading vectors or starting execution');
    assert.equal(existsSync(absent),false);unchanged();
    records.push({id:row.id,expected:row.expected,archive:sha(archive),model:sha(model),metadata:sha(metadata),provenance:sha(provenance)});
  }
  assert.equal(records.length,24);return records;
}
