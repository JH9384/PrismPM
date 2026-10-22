// Test infrastructure: freeze a fresh generator's complete declared output.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, opendirSync, realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {captureFile} from './file-custody.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const layouts = Object.freeze({
  native: {schema: 'lean4-prod/cargo-package-manifest/1',
    files: ['Cargo.lock', 'Cargo.toml', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'src/lib.rs']},
  wasm: {schema: 'lean4-prod/core-wasm-target/1',
    files: ['.cargo/config.toml', 'Cargo.lock', 'Cargo.toml', 'src/lib.rs']},
});
const manifestPath = 'generation-manifest.json';
const canonical = value => JSON.stringify(value, (_key, child) =>
  child && !Array.isArray(child) && typeof child === 'object'
    ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
function closed(value, keys, label) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, label);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), label);
}

function fileBytes(path) {
  return captureFile(path).bytes;
}

function inventory(directory, kind, inputIrSha256) {
  assert.equal(resolve(directory), directory, 'absolute normalized generated package');
  assert.ok(Object.hasOwn(layouts, kind), 'closed generated package kind');
  assert.match(inputIrSha256, /^[a-f0-9]{64}$/, 'exact expected input IR');
  const layout = layouts[kind], before = fileBytes(join(directory, manifestPath));
  const manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(before));
  assert.deepEqual(Buffer.from(canonical(manifest) + '\n'), before, 'canonical generated manifest bytes');
  closed(manifest, kind === 'native'
    ? ['dependencies', 'files', 'input_ir_sha256', 'module', 'schema']
    : ['entry', 'export', 'files', 'input_allocation_cap', 'input_ir_sha256',
      'maximum_pages', 'output_allocation_cap', 'schema'], 'closed generated manifest');
  if (kind === 'native') {
    assert.equal(typeof manifest.module, 'string'); assert(manifest.module.length > 0 && manifest.module.length <= 4096);
    assert(Array.isArray(manifest.dependencies) && manifest.dependencies.length <= 256, 'bounded generated dependencies');
    const names = new Set();
    for (const dependency of manifest.dependencies) {
      closed(dependency, ['checksum', 'default_features', 'features', 'name', 'version'], 'closed generated dependency');
      assert.match(dependency.name, /^[a-z][a-z0-9_-]{0,63}$/);
      assert(!names.has(dependency.name), 'unique generated dependency'); names.add(dependency.name);
      assert.match(dependency.checksum, /^[a-f0-9]{64}$/);
      assert.equal(typeof dependency.default_features, 'boolean');
      assert.match(dependency.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
      assert(Array.isArray(dependency.features) && dependency.features.length <= 256);
      assert.equal(new Set(dependency.features).size, dependency.features.length, 'unique generated features');
      for (const feature of dependency.features) assert.match(feature, /^[a-z][a-z0-9_-]{0,63}$/);
    }
  } else {
    for (const key of ['entry', 'export']) {
      assert.match(manifest[key], /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
    }
    assert(Number.isInteger(manifest.maximum_pages) && manifest.maximum_pages > 0 && manifest.maximum_pages <= 32767);
    for (const key of ['input_allocation_cap', 'output_allocation_cap'])
      assert(Number.isSafeInteger(manifest[key]) && manifest[key] > 0
        && manifest[key] <= 4294967295, 'bounded generated allocation');
  }
  assert.equal(manifest.schema, layout.schema, 'exact generated package schema');
  assert.equal(manifest.input_ir_sha256, inputIrSha256, 'generated package input IR');
  assert.ok(Array.isArray(manifest.files));
  assert.deepEqual(manifest.files.map(row => row.path), layout.files, 'closed generated file declarations');
  const declared = new Map(manifest.files.map(row => {
    assert.deepEqual(Object.keys(row).sort(), ['path', 'sha256']);
    assert.match(row.sha256, /^[a-f0-9]{64}$/); return [row.path, row.sha256];
  }));
  const expectedFiles = [...layout.files, manifestPath].sort(), expectedDirectories = new Set(['']);
  for (const path of expectedFiles) {
    let parent = dirname(path);
    while (parent !== '.') {expectedDirectories.add(parent); parent = dirname(parent);}
  }
  const directories = [], files = {};
  function visit(relative) {
    const path = relative ? join(directory, relative) : directory;
    assert.equal(realpathSync(path), path, 'unaliased generated package directory');
    assert.ok(lstatSync(path).isDirectory(), 'actual generated package directory');
    directories.push(relative);
    const handle = opendirSync(path), children = [];
    try {
      for (let entry; (entry = handle.readSync()) !== null;) {
        assert(children.length < expectedFiles.length + expectedDirectories.size, 'bounded generated package inventory');
        const child = relative ? relative + '/' + entry.name : entry.name;
        assert(expectedFiles.includes(child) || expectedDirectories.has(child), 'complete generated package file inventory');
        children.push(child);
      }
    } finally {handle.closeSync();}
    for (const child of children.sort()) {
      const absolute = join(directory, child), stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        assert(expectedDirectories.has(child), 'complete generated package directory inventory'); visit(child);
      } else {
        assert(expectedFiles.includes(child), 'complete generated package file inventory');
        files[child] = captureFile(absolute).evidence.sha256;
      }
    }
  }
  visit('');
  assert.deepEqual(Object.keys(files).sort(), expectedFiles, 'complete generated package file inventory');
  assert.deepEqual(directories.sort(), [...expectedDirectories].sort(), 'complete generated package directory inventory');
  for (const [path, sha256] of declared) assert.equal(files[path], sha256, 'generated package manifest digest ' + path);
  assert.deepEqual(fileBytes(join(directory, manifestPath)), before, 'stable generation manifest during capture');
  assert.equal(files[manifestPath], digest(before), 'captured generation manifest');
  return Object.freeze(Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))));
}

export function captureGeneratedPackage(directory, {kind, inputIrSha256}) {
  const files = inventory(directory, kind, inputIrSha256);
  return Object.freeze({directory, kind, inputIrSha256, files,
    verify() {
      assert.deepEqual(inventory(directory, kind, inputIrSha256), files,
        'immutable generated package captured immediately after code generation');
    }});
}
