import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareFrames, sha} from './compile.mjs';
import {corpus} from './corpus.mjs';
import {executeWasm, tsv} from './runtime.mjs';

export function exactNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' recovery frame vectors twice\n');
}
export function verifyBaseline() {
  const build = prepareFrames(), vectors = corpus(), results = {};
  assert.deepEqual(Object.fromEntries(Object.entries(vectors).map(([name, rows]) => [name, rows.length])),
    {layout: 1467, tail: 365, parity: 36, composition: 23});
  const source = join(build.work, 'generated/src/lib.rs'), original = readFileSync(source);
  try {
    writeFileSync(source, Buffer.concat([original, Buffer.from('\n// substituted generated source\n')]));
    for (const standard of [true, false]) assert.throws(() => build.compileNative(standard), /generated package manifest digest/);
  } finally {writeFileSync(source, original);}
  for (const entry of ['layout', 'tail', 'parity']) {
    const rows = vectors[entry], path = join(build.work, entry + '.tsv');
    writeFileSync(path, tsv(rows), {flag: 'wx'});
    for (const standard of [true, false]) exactNativeInventory(build.runNative(standard, [entry, path]), rows);
    results[entry] = {cases: rows.length, wasm: sha(build.wasm[entry]), ...executeWasm(build.wasm[entry], rows)};
  }
  build.unchanged();
  const evidence = {scope: 'private-recovery-frames-baseline-only', accepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, inputs: build.inputs, results, native: build.nativeEvidence(),
    generatedPackages: build.generatedPackages, cacheRetirement: build.cacheRetirement};
  writeFileSync(join(build.work, 'baseline-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}
