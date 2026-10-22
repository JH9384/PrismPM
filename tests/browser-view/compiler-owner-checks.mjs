// Actual defects in a freshly constructed compiler owner; no surrogate tool.
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {requireCompilerOwner} from './compiler-owner.mjs';

// Inventory lookup only; callers must first validate the genuine family owner.
export function compilerDriverDirectory(inputs) {
  const paths = Object.keys(inputs).filter(path => /^tests\/(?:browser-(?:[a-z-]+|p256)|publication-admission|publication-context-linkage|holo-primary-component)\/driver\/src\/main\.rs$/.test(path));
  assert.equal(paths.length, 1, 'one source-bound family driver required');
  return paths[0].slice(0, -'/src/main.rs'.length);
}

export function verifyCompilerOwnerSubstitutions(owner) {
  const name = owner.evidence.family;
  requireCompilerOwner(owner, name);
  assert.throws(() => requireCompilerOwner({...owner}, name), /actual fresh compiler owner/);
  const changedInputs = {...owner.evidence.inputs, 'lean-toolchain': '0'.repeat(64)};
  assert.throws(() => requireCompilerOwner(owner, name === 'view' ? 'effects' : 'view'), /same registered compiler family/);
  assert.throws(() => {owner.evidence.inputs['lean-toolchain'] = '0'.repeat(64);}, TypeError);
  assert.throws(() => {owner.runDriver = () => '';}, TypeError);
  const work = owner.evidence.work, observed = ['cloned-handle', 'cross-family-handle', 'immutable-owner'];
  const driverDirectory = compilerDriverDirectory(owner.evidence.inputs);
  const library = Object.keys(owner.evidence.exporterRuntime).find(path => path.endsWith('.olean'));
  assert.ok(library, 'actual compiled exporter runtime library required');
  const files = [
    ['driver-source', join(work, driverDirectory, 'src/main.rs'), /captured compiler source/],
    ['driver-lock', join(work, driverDirectory, 'Cargo.lock'), /captured compiler source/],
    ['exporter-library', join(work, 'exporter', library), /immutable complete exporter runtime closure/],
    ...['driver', 'exporter'].flatMap(kind => ['original', 'private'].map(side =>
      [kind + '-' + side, join(work, owner.evidence[kind][side].path),
        /immutable (original|private) compiler|immutable complete exporter runtime closure/]))];
  for (const [name, path, message] of files) {
    const bytes = readFileSync(path), mode = lstatSync(path).mode & 0o777;
    try {
      chmodSync(path, mode | 0o200); writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
      assert.throws(() => owner.verify(), message);
      assert.throws(() => owner.runDriver(['--help'], work), message,
        'changed closure must refuse before actual compiler invocation');
      assert.throws(() => owner.runExporter(['--help'], work), message);
      observed.push(name);
    } finally {writeFileSync(path, bytes); chmodSync(path, mode);}
    owner.verify();
  }
  const exporter = join(work, 'exporter');
  for (const [kind, path] of [
    ['exporter-root-mode', exporter], ['exporter-build-mode', join(exporter, '.lake')],
    ['exporter-library-mode', join(exporter, library)],
    ...['driver', 'exporter'].flatMap(kind => ['original', 'private'].map(side =>
      [kind + '-' + side + '-mode', join(work, owner.evidence[kind][side].path)])),
  ]) {
    const mode = lstatSync(path).mode & 0o777;
    try {
      chmodSync(path, mode ^ 0o040);
      const message = /immutable (original|private) compiler|immutable complete exporter runtime closure/;
      assert.throws(() => owner.verify(), message);
      assert.throws(() => owner.runDriver(['--help'], work), message);
      assert.throws(() => owner.runExporter(['--help'], work), message);
      observed.push(kind);
    } finally {chmodSync(path, mode);}
    owner.verify();
  }
  // An apparently matching disk receipt cannot override the live captured map.
  const forged = join(work, 'forged-compiler-evidence.json');
  writeFileSync(forged, JSON.stringify({...owner.evidence, inputs: changedInputs}), {flag: 'wx'});
  try {assert.throws(() => requireCompilerOwner({...owner, evidence: JSON.parse(readFileSync(forged))}, name), /actual fresh compiler owner/);}
  finally {unlinkSync(forged);}
  observed.push('forged-disk-receipt');
  for (const kind of ['driver', 'exporter']) {
    const path = join(work, owner.evidence[kind].private.path), saved = join(work, kind + '-identity-original');
    renameSync(path, saved);
    try {
      copyFileSync(saved, path);
      assert.throws(() => owner.verify(), /immutable private compiler/);
      observed.push(kind + '-same-byte-inode');
    } finally {unlinkSync(path); renameSync(saved, path);}
    owner.verify();
  }
  return observed;
}
