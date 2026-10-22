import assert from 'node:assert/strict';
import {existsSync,linkSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {preparePayloads,sha} from './compile.mjs';
import {executeWasm,tsv} from './runtime.mjs';
import {corpus as journalCorpus,partitionCorpus} from '../browser-operation-journal/corpus.mjs';
import {retentionCorpus} from '../browser-session-journal/retention-corpus.mjs';
import {capturePayloadSources} from './browser.mjs';
import {payloadJourneys,verifyPayloadJourney} from './journeys.mjs';
import {payloadHostMutations,mutatePayloadHost} from './mutations.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-session-journal/wasm-artifact-checks.mjs';
import {verifyTranscriptRetention} from './transcript-retention.mjs';

export function payloadCorpus() {return {journal:journalCorpus(),partition:partitionCorpus(),retention:retentionCorpus()};}
export function verifyPayloadComponents() {
  const build=preparePayloads(),vectors=payloadCorpus(),observed={};
  let complete=false;
  try {
  // Plant actual generated-source defects before either first Cargo build.
  // Rewriting a matching manifest must not replace the in-memory capture.
  const library = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(library), originalManifest = readFileSync(manifest);
  for (const mode of ['source', 'source-and-manifest', 'extra-file', 'hard-link']) {
    const refusal = {source: /generated package manifest digest src\/lib\.rs/,
      'source-and-manifest': /immutable generated package captured immediately after code generation/,
      'extra-file': /complete generated package file inventory/, 'hard-link': /bounded single-link custody file/}[mode];
    const extra = mode === 'hard-link' ? join(build.work, 'linked-generated-source') : join(build.work, 'generated/unexpected');
    try {
      if (mode === 'source' || mode === 'source-and-manifest') {
        writeFileSync(library, Buffer.concat([original, Buffer.from('\n// planted generated-source change\n')]));
        if (mode === 'source-and-manifest') {const value = JSON.parse(originalManifest); value.files.find(row => row.path === 'src/lib.rs').sha256 = sha(readFileSync(library));
          writeFileSync(manifest, JSON.stringify(value, (_key, child) => child && !Array.isArray(child) && typeof child === 'object'
            ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child) + '\n');}
      } else if (mode === 'extra-file') writeFileSync(extra, 'planted extra package input', {flag: 'wx'});
      else linkSync(library, extra);
      for (const standard of [true, false]) {
        assert.throws(() => build.compileNative(standard), refusal);
        assert.ok(!existsSync(join(build.work, standard ? 'runner-std' : 'runner-no-std')), 'changed source refused before first observer/compiler creation');
      }
      assert.throws(() => build.unchanged(), refusal);
    } finally {
      if (mode === 'source' || mode === 'source-and-manifest') {writeFileSync(library, original); writeFileSync(manifest, originalManifest);}
      else unlinkSync(extra);
    }
    build.unchanged();
  }
  assert.deepEqual(Object.fromEntries(Object.entries(vectors).map(([name,rows])=>[name,rows.length])),
    {journal:68,partition:7,retention:86});
  const substitutions=verifyWasmArtifactSubstitutions(build);
  for(const [entry,rows] of Object.entries(vectors)) {
    assert.ok(rows.length>0);
    const artifact=requireGeneratedWasm(build.wasmOwners[entry]);
    if(entry==='partition') {
      for(const row of rows) {
        const inputName=row.id+'-input.bin',outputName=row.id+'-expected.bin';
        const input=build.transcripts.write(inputName,row.request),output=build.transcripts.write(outputName,row.response);
        for(const standard of [true,false])build.transcripts.consume(standard,[inputName,outputName],()=>
          assert.equal(build.runNative(standard,[entry,input,output]),'PASS binary session payload twice\n'));
      }
    } else {
      const file=join(build.work,entry+'.tsv');writeFileSync(file,tsv(rows),{flag:'wx'});
      const expected=rows.map(row=>'PASS '+row.id+'\n').join('')+'PASS '+rows.length+' session payload vectors twice\n';
      for(const standard of [true,false])assert.equal(build.runNative(standard,[entry,file]),expected);
    }
    observed[entry]=artifact.run(bytes=>executeWasm(bytes,rows.filter(row=>!row.nativeOnly)));
  }
  for(const standard of [true,false]) {
    const path=build.compileNative(standard),original=readFileSync(path),changed=Buffer.from(original);changed[changed.length-1]^=1;
    try {
      writeFileSync(path,changed);
      assert.throws(()=>build.runNative(standard,['journal',join(build.work,'journal.tsv')]),/private native executable changed/);
      assert.throws(()=>build.unchanged(),/private native executable changed/);
    } finally {writeFileSync(path,original);}
    build.unchanged();
  }
  build.unchanged();
  complete=true;
  return {build,evidence:{scope:'private-generated-payload-component',publicApplicationAccepted:false,
    source:build.verified.source_id,attestation:build.verified.attestation_id,ir:build.generation.ir_sha256,
    inputs:build.inputs,cases:Object.fromEntries(Object.entries(vectors).map(([entry,rows])=>[entry,rows.length])),
    observed,generatedWasm:build.generatedWasm,generatedPackages:build.generatedPackages,native:build.nativeEvidence(),
    substitutions,nativeArtifactSubstitutionRejected:['std','no-std'],
    generatedSourceSubstitutionRejected:['source','source-and-manifest','extra-file','hard-link'],
    cacheRetirement:build.cacheRetirement}};
  } finally {if(!complete)build.transcripts.close();}
}
export async function verifyPayloadOwner(t) {
  const {build,evidence}=verifyPayloadComponents(),journeys=[],mutants=[];
  try {
  for(const row of payloadJourneys) {
    let failure;
    await t.test('actual payload '+row.id,async()=>{
      try {const result=await verifyPayloadJourney(build,row);journeys.push({id:row.id,result:result.result,calls:result.calls});}
      catch(error){failure=error;throw error;}
    });
    if(failure)throw failure;
  }
  assert.equal(journeys.length,19);
  const sources=capturePayloadSources(build.inputs);
  for(const mutation of payloadHostMutations) {
    const module=mutation.module??'session-payloads.mjs',source=sources[module];assert.ok(source);
    const changed=mutatePayloadHost(source,mutation),row=payloadJourneys.find(row=>row.id===mutation.journey);assert.ok(row);
    const options=module==='session-storage.mjs'?{storageSource:changed}:{source:changed};
    let failure;
    await t.test('actual payload host defect '+mutation.id,async()=>{
      try {await assert.rejects(verifyPayloadJourney(build,row,{...options,label:'mutant-'+mutation.id}),
        error=>error.code==='ERR_ASSERTION'&&error.message.includes('payload journey '+mutation.journey+' contract'),
        'the exact named semantic counterexample, not syntax/launch or unrelated assertion, is required');}
      catch(error){failure=error;throw error;}
    });
    if(failure)throw failure;
    mutants.push({id:mutation.id,module,source:sha(changed),journey:mutation.journey});
  }
  assert.equal(mutants.length,10);build.unchanged();
  const transcriptRetention=await build.transcripts.retainCompleted();
  const transcriptReadback=await verifyTranscriptRetention(build.work,transcriptRetention);
  build.unchanged();
  const receipt={...evidence,scope:'private-payload-source-and-browser-owner',journeys,mutants,transcriptRetention,transcriptReadback};
  const path=join(build.work,'payload-owner-evidence.json');writeFileSync(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return {build,evidence:receipt,receipt:sha(readFileSync(path))};
  } finally {build.transcripts.close();}
}
