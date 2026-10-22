import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {preparePkce, sha} from './compile.mjs';
import {corpus, tsv} from './corpus.mjs';
import {executeWasm} from './runtime.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';

export function replay(build, rows, name) {
  const path = join(build.work, name + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  const expected = rows.map(row => 'PASS ' + row.id + '\n').join('') + 'PASS ' + rows.length + ' PKCE vectors twice\n';
  for (const standard of [true, false]) assert.equal(build.runNative(standard, [path]), expected);
  return {cases: rows.length, transcript: sha(readFileSync(path))};
}
export async function component(compiler, inputs) {
  const build = preparePkce(compiler, inputs), rows = corpus();
  const library = join(build.work, 'generated/src/lib.rs'), original = readFileSync(library);
  try {
    writeFileSync(library, Buffer.concat([original, Buffer.from('\n// unowned substitution\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => build.compileNative(standard), /generated package/);
      assert.equal(existsSync(join(build.work, standard ? 'runner-std' : 'runner-no-std')), false);
    }
  } finally {writeFileSync(library, original);}
  build.unchanged();
  const native = replay(build, rows, 'complete-corpus');
  const wasm = await requireGeneratedWasm(build.wasmOwners.pkce).runAsync(bytes => executeWasm(bytes, rows));
  build.unchanged();
  return {build, evidence: {source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, native, wasm, compiler: build.compiler, inputs, provenance: build.provenance,
    packages: build.generatedPackages, generatedWasm: build.generatedWasm}};
}
export async function sourceMutation(compiler, inputs, baseline, mutation) {
  const build = preparePkce(compiler, inputs, mutation.id), row = corpus().find(row => row.id === mutation.probe);
  assert.ok(row); assert.notEqual(build.verified.source_id, baseline.verified.source_id);
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const path = join(build.work, 'counterexample.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]),
    error => error.message.includes(row.id + ' native output mismatch'), 'named native behavioral rejection');
  await assert.rejects(requireGeneratedWasm(build.wasmOwners.pkce).runAsync(bytes => executeWasm(bytes, [row])),
    error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id + ' Wasm output mismatch'),
    'named Wasm behavior rejection, not compile error or trap');
  build.unchanged(); baseline.unchanged();
  const evidence = {id: mutation.id, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: build.generatedWasm, native: build.nativeEvidence(),
    request: sha(row.request), response: sha(row.response), work: build.work};
  writeFileSync(join(build.work, 'mutation.json'), JSON.stringify(evidence) + '\n', {flag: 'wx'});
  return evidence;
}
