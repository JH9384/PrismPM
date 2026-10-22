// Conformance witness over real retained native-library compiler/package output.
// Never construct positive compiler evidence or modify its original directory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkAccepted} from './library-sdk-check.mjs';

const [project,encodedReceipt,archive,toolchain]=process.argv.slice(2);
const receipt=JSON.parse(encodedReceipt),compiler={toolchain};
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=value=>createHash('sha256').update(value).digest('hex');
const original=join(project,receipt.verified_root),bytes=readFileSync(join(original,'manifest.json'));
const baseline=JSON.parse(bytes);
checkAccepted(project,receipt,archive,compiler);
const mutations=[
 value=>{for(const phase of value.exporter_owner.phases)phase.processes[2].argv.push('--unowned');value.processes[7].argv.push('--unowned');},
 value=>{for(const phase of value.exporter_owner.phases)phase.lexlean_manifest_sha256='f'.repeat(64);},
 value=>{for(const phase of value.exporter_owner.phases)phase.artifacts[0].sha256='f'.repeat(64);value.artifacts[0].sha256='f'.repeat(64);},
 value=>{for(const phase of value.exporter_owner.phases)phase.processes[2].exporter.source_archive_sha256='f'.repeat(64);value.processes[7].exporter.source_archive_sha256='f'.repeat(64);},
 value=>{value.exporter_owner.phases[0].processes[2].exporter.acquisition={schema:'prismpm/exporter-acquisition/1',mode:'sdk-seed'};},
 value=>{value.exporter_owner.phases[0].processes[2].exporter.executable.sha256='f'.repeat(64);},
 value=>{delete value.exporter_owner;value.schema='prismpm/library-verification-manifest/1';},
];
for(const mutate of mutations){
 const changed=structuredClone(baseline);mutate(changed);
 const body=Buffer.from(canonical(changed)),id=hash(body),directory=join(project,'.prism/verified',id);
 assert(!existsSync(directory),'mutation output must be newly owned');mkdirSync(directory);
 try{
  for(const name of ['lexlean-attestation.json','library-acceptance.json'])copyFileSync(join(original,name),join(directory,name));
  writeFileSync(join(directory,'manifest.json'),body,{flag:'wx'});
  assert.throws(()=>checkAccepted(project,{...receipt,attestation_id:id,verified_root:'.prism/verified/'+id},archive,compiler));
 }finally{rmSync(directory,{recursive:true});}
}
assert(readFileSync(join(original,'manifest.json')).equals(bytes));
checkAccepted(project,receipt,archive,compiler);
console.log(JSON.stringify({schema:'prismpm/native-library-reader-regression/1',real_baseline:'passed',mutations_rejected:mutations.length,restored_baseline:'passed'}));
