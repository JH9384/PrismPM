// Same-header artifact substitutions, rejected before any Wasm callback.
// Last-byte changes need not preserve a fully valid module.
import assert from 'node:assert/strict';
import {chmodSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';

export function verifyWasmArtifactSubstitutions(build) {
  assert.ok(Object.isFrozen(build) && Object.isFrozen(build.wasm)
    && Object.isFrozen(build.wasmOwners) && Object.isFrozen(build.wasmArtifacts));
  for (const key of ['wasm', 'wasmOwners', 'wasmArtifacts']) {
    assert.throws(() => {build[key] = {...build[key]};}, TypeError,
      'captured build cannot adopt a replacement ' + key);
  }
  for (const entry of Object.keys(build.wasmOwners)) {
    const other = requireGeneratedWasm(build.wasmArtifacts[entry + '-b']);
    assert.notEqual(build.wasmOwners[entry], other, 'independent second output');
    assert.throws(() => {build.wasmOwners[entry] = other;}, TypeError,
      'selected captured output cannot be swapped');
    assert.throws(() => {build.wasm[entry] = other.bytes;}, TypeError);
  }
  const rows = [];
  for (const [name, value] of Object.entries(build.wasmArtifacts)) {
    const artifact = requireGeneratedWasm(value);
    assert.throws(() => requireGeneratedWasm({...artifact}), /actual captured generated Wasm/);
    for (const target of ['original', 'private', 'buffer']) {
      const path = target === 'buffer' ? null : target === 'private' ? artifact.path : join(build.work, artifact.evidence.original.path);
      const original = Buffer.from(path === null ? artifact.bytes : readFileSync(path)), changed = Buffer.from(original);
      changed[changed.length - 1] ^= 1;
      const mode = path === null ? null : lstatSync(path).mode & 0o777;
      let called = false;
      try {
        if (path === null) artifact.bytes.set(changed);
        else {chmodSync(path, mode | 0o200); writeFileSync(path, changed);}
        assert.throws(() => artifact.run(() => {called = true;}), /immutable (original|private|execution)/);
        assert.equal(called, false, name + ':' + target + ' rejected before execution');
        assert.throws(() => build.unchanged(), /immutable (original|private|execution)/);
      } finally {
        if (path === null) artifact.bytes.set(original);
        else {writeFileSync(path, original); chmodSync(path, mode);}
      }
      build.unchanged(); rows.push(name + ':' + target);
    }
  }
  assert.equal(rows.length, Object.keys(build.wasmArtifacts).length * 3);
  return rows;
}
