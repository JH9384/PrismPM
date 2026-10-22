import assert from 'node:assert/strict';
import {linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from './wasm-artifact-checks.mjs';

test('owning substitutions cover both original outputs, private files and execution buffers', t => {
  const work=mkdtempSync(join(tmpdir(),'prismpm-owning-wasm-'));
  t.after(()=>rmSync(work,{recursive:true}));
  const artifacts={};
  for(const label of ['a','b']) {
    const directory=join(work,label);mkdirSync(directory);
    const original=join(directory,'probe.wasm');
    writeFileSync(original,Buffer.from([0,97,115,109,1,0,0,0,0,3,1,120,42]));
    linkSync(original,join(directory,'cargo-dependency.wasm'));
    artifacts['probe-'+label]=captureGeneratedWasm(work,original,'probe-'+label+'-execution');
  }
  const build=Object.freeze({work,wasm:Object.freeze({probe:artifacts['probe-a'].bytes}),
    wasmOwners:Object.freeze({probe:artifacts['probe-a']}),wasmArtifacts:Object.freeze(artifacts),
    unchanged(){for(const artifact of Object.values(artifacts))artifact.verify();}});
  assert.deepEqual(verifyWasmArtifactSubstitutions(build),[
    'probe-a:original','probe-a:private','probe-a:buffer','probe-b:original','probe-b:private','probe-b:buffer',
  ]);
  for(const artifact of Object.values(artifacts))assert.equal(artifact.run(bytes=>WebAssembly.validate(bytes)),true);
  assert.throws(()=>verifyWasmArtifactSubstitutions({...build,wasm:{...build.wasm}}));
  assert.throws(()=>verifyWasmArtifactSubstitutions({...build}));
});
