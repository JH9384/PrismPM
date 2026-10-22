import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {captureGeneratedPackage} from './generated-package.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex'), ir = sha('synthetic fixture IR');
function fixture(t, kind = 'native') {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-generated-package-test-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const paths = kind === 'native'
    ? ['Cargo.lock', 'Cargo.toml', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'src/lib.rs']
    : ['.cargo/config.toml', 'Cargo.lock', 'Cargo.toml', 'src/lib.rs'];
  const files = paths.map(path => {
    const bytes = Buffer.from('synthetic fixture: ' + path + '\n');
    mkdirSync(dirname(join(directory, path)), {recursive: true}); writeFileSync(join(directory, path), bytes, {flag: 'wx'});
    return {path, sha256: sha(bytes)};
  });
  const manifest = {...(kind === 'native' ? {dependencies: [], module: 'Fixture'}
    : {entry: 'fixtureBytes', export: 'holo_run', input_allocation_cap: 32,
      output_allocation_cap: 67108864, maximum_pages: 16384}),
    schema: kind === 'native' ? 'lean4-prod/cargo-package-manifest/1' : 'lean4-prod/core-wasm-target/1',
    input_ir_sha256: ir, files};
  const canonical = value => JSON.stringify(value, (_key, child) =>
    child && !Array.isArray(child) && typeof child === 'object'
      ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
  const writeManifest = () => writeFileSync(join(directory, 'generation-manifest.json'), canonical(manifest) + '\n');
  writeManifest();
  return {directory, manifest, writeManifest, capture: () => captureGeneratedPackage(directory, {kind, inputIrSha256: ir})};
}

test('fresh native and Wasm output have exact declared files and directories', t => {
  for (const kind of ['native', 'wasm']) {
    const value = fixture(t, kind), captured = value.capture(); captured.verify();
    assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.files));
    assert.equal(Object.keys(captured.files).length, kind === 'native' ? 7 : 5);
  }
});
test('changed source bytes and a rewritten matching manifest cannot replace captured output', t => {
  for (const kind of ['native', 'wasm']) {
    const value = fixture(t, kind), captured = value.capture(), path = join(value.directory, 'src/lib.rs');
    writeFileSync(path, 'substituted generated source');
    assert.throws(() => captured.verify(), /manifest digest/);
    value.manifest.files.find(row => row.path === 'src/lib.rs').sha256 = sha(readFileSync(path)); value.writeManifest();
    // A fresh capture must accept the coherently forged package. Only the
    // immediately captured original identity is allowed to reject it here.
    value.capture().verify();
    assert.throws(() => captured.verify(), /immutable generated package captured immediately after code generation/);
    const manifest = join(value.directory, 'generation-manifest.json'), bytes = readFileSync(manifest);
    writeFileSync(manifest, bytes.subarray(0, bytes.length - 1));
    assert.throws(() => captured.verify(), /canonical generated manifest bytes/);
  }
});
test('initial manifests reject extra fields, duplicate JSON keys and noncanonical bytes', t => {
  for (const kind of ['native', 'wasm']) for (const mutation of ['extra', 'duplicate', 'space', 'invalid-utf8']) {
    const value = fixture(t, kind), path = join(value.directory, 'generation-manifest.json');
    if (mutation === 'extra') {value.manifest.unexpected = true; value.writeManifest();}
    else {
      const bytes = readFileSync(path), text = bytes.toString();
      writeFileSync(path, mutation === 'duplicate' ? text.replace('{', '{"schema":"duplicate",')
        : mutation === 'space' ? ' ' + text : Buffer.concat([Buffer.from([0xff]), bytes]));
    }
    assert.throws(value.capture, /closed generated manifest|canonical generated manifest|encoded data/);
  }
});
test('generated allocation and dependency metadata obey the actual producer schema', t => {
  const actualSmallGuest = fixture(t, 'wasm');
  actualSmallGuest.manifest.maximum_pages = 256;
  actualSmallGuest.writeManifest();
  actualSmallGuest.capture().verify(); // Producer caps are u32, not an allocation guarantee.
  for (const mutation of ['over', 'zero', 'float', 'entry', 'pages', 'entry-syntax', 'export-long']) {
    const value = fixture(t, 'wasm');
    if (mutation === 'entry') value.manifest.entry = '';
    else if (mutation === 'pages') value.manifest.maximum_pages = 32768;
    else if (mutation === 'entry-syntax') value.manifest.entry = '1invalid';
    else if (mutation === 'export-long') value.manifest.export = 'x'.repeat(129);
    else value.manifest.input_allocation_cap = mutation === 'over' ? 2 ** 32 + 1 : mutation === 'zero' ? 0 : 0.5;
    value.writeManifest(); assert.throws(value.capture, assert.AssertionError);
  }
  const value = fixture(t); value.manifest.dependencies = [{name: 'unexpected'}];
  value.writeManifest(); assert.throws(value.capture, /closed generated dependency/);
  for (const mutation of ['name', 'version', 'feature', 'name-long', 'leading-zero']) {
    const value = fixture(t), dependency = {name: 'valid', version: '1.2.3',
      checksum: '0'.repeat(64), default_features: false, features: ['valid_feature']};
    if (mutation === 'name') dependency.name = 'Invalid';
    if (mutation === 'version') dependency.version = '1.2';
    if (mutation === 'feature') dependency.features = ['Invalid'];
    if (mutation === 'name-long') dependency.name = 'a'.repeat(65);
    if (mutation === 'leading-zero') dependency.version = '01.2.3';
    value.manifest.dependencies = [dependency]; value.writeManifest();
    assert.throws(value.capture, assert.AssertionError);
  }
});
test('manifest rejects wrong IR, schema, digest and missing/extra/repeated declarations', t => {
  for (const change of [m => {m.input_ir_sha256 = sha('other');}, m => {m.schema += 'x';},
    m => {m.files[0].sha256 = 'not-a-digest';}, m => {m.files.pop();},
    m => {m.files.push(m.files[0]);}, m => {m.files[0].path = '../outside';}]) {
    const value = fixture(t); change(value.manifest); value.writeManifest(); assert.throws(value.capture);
  }
});
test('missing files, extra files and empty extra directories are rejected', t => {
  for (const change of [root => unlinkSync(join(root, 'src/lib.rs')),
    root => writeFileSync(join(root, 'extra'), 'unexpected'), root => mkdirSync(join(root, 'extra'))]) {
    const value = fixture(t), captured = value.capture(); change(value.directory);
    assert.throws(value.capture); assert.throws(() => captured.verify());
  }
});
test('file/directory aliases and hard-linked files are rejected', t => {
  for (const mode of ['symlink-file', 'symlink-directory', 'hardlink-file']) {
    const value = fixture(t), captured = value.capture(), extra = mkdtempSync(join(tmpdir(), 'prismpm-generated-alias-test-'));
    t.after(() => rmSync(extra, {recursive: true, force: true}));
    const original = join(value.directory, 'src/lib.rs'), bytes = readFileSync(original);
    if (mode === 'hardlink-file') linkSync(original, join(extra, 'alias'));
    else if (mode === 'symlink-file') {
      const outside = join(extra, 'lib.rs'); writeFileSync(outside, bytes); unlinkSync(original); symlinkSync(outside, original);
    } else {
      rmSync(join(value.directory, 'src'), {recursive: true}); writeFileSync(join(extra, 'lib.rs'), bytes);
      symlinkSync(extra, join(value.directory, 'src'));
    }
    assert.throws(value.capture); assert.throws(() => captured.verify());
  }
});
test('a manifest-only change is rejected even if declared source bytes stay unchanged', t => {
  const value = fixture(t), captured = value.capture(); value.manifest.unexpected = true; value.writeManifest();
  assert.throws(() => captured.verify(), /closed generated manifest/);
});
