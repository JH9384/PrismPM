import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { canonical, generate, project } from './ingress-nginx-projection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const yamlPath = 'adapters/ingress-nginx-kind-v1.15.1.yaml';
const jsonPath = 'adapters/ingress-nginx-kind-v1.15.1.json';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-ingress-projection-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const path of ['adapters', 'sdk', 'sdk/oracles']) mkdirSync(join(directory, path));
  for (const path of [yamlPath, jsonPath, 'adapters/kubernetes.json', 'tools.lock', 'sdk/oracles/package.json', 'sdk/oracles/package-lock.json']) {
    copyFileSync(join(root, path), join(directory, path));
  }
  return directory;
}

test('fixed upstream YAML regenerates all nineteen resources without normalization', () => {
  const result = generate(root), values = JSON.parse(readFileSync(join(root, jsonPath)));
  assert.equal(result.resources, 19);
  assert.deepEqual(values.map(row => row.kind), ['Namespace', 'ServiceAccount', 'ServiceAccount', 'Role', 'Role', 'ClusterRole', 'ClusterRole', 'RoleBinding', 'RoleBinding', 'ClusterRoleBinding', 'ClusterRoleBinding', 'ConfigMap', 'Service', 'Service', 'Deployment', 'Job', 'Job', 'IngressClass', 'ValidatingWebhookConfiguration']);
  assert.equal(values[11].data, null);
  assert.equal(values[17].metadata.name, 'nginx');
  assert.deepEqual(project(readFileSync(join(root, yamlPath))), readFileSync(join(root, jsonPath)));
});

test('writer is byte-idempotent and check refuses missing, changed, dropped, reordered or extra resources', t => {
  const directory = fixture(t), original = readFileSync(join(directory, jsonPath));
  assert.deepEqual(generate(directory, true), generate(directory));
  assert.deepEqual(readFileSync(join(directory, jsonPath)), original);
  const values = JSON.parse(original);
  for (const mutated of [values.slice(1), [...values].reverse(), [...values, values[0]], values.map((v, i) => i === 11 ? {...v, data: {}} : v)]) {
    writeFileSync(join(directory, jsonPath), canonical(mutated));
    assert.throws(() => generate(directory), /stale/);
  }
  rmSync(join(directory, jsonPath)); assert.throws(() => generate(directory), {code: 'ENOENT'});
  generate(directory, true); assert.deepEqual(readFileSync(join(directory, jsonPath)), original);
});

test('upstream digest and pinned parser changes refuse instead of silently regenerating', t => {
  const directory = fixture(t), original = readFileSync(join(directory, yamlPath));
  writeFileSync(join(directory, yamlPath), Buffer.concat([original, Buffer.from('\n')]));
  assert.throws(() => generate(directory, true), /digest differs/);
  writeFileSync(join(directory, yamlPath), original);
  const path = join(directory, 'sdk/oracles/package.json'), value = JSON.parse(readFileSync(path));
  value.dependencies['js-yaml'] = '0.0.0'; writeFileSync(path, JSON.stringify(value));
  assert.throws(() => generate(directory), {code: 'ERR_ASSERTION'});
});

test('projection input and output aliases refuse without changing referents', t => {
  const directory = fixture(t), before = readFileSync(join(directory, jsonPath));
  rmSync(join(directory, jsonPath)); symlinkSync(join(root, jsonPath), join(directory, jsonPath));
  assert.throws(() => generate(directory, true), /single regular/);
  assert.deepEqual(readFileSync(join(root, jsonPath)), before);
  rmSync(join(directory, yamlPath)); symlinkSync(join(root, yamlPath), join(directory, yamlPath));
  assert.throws(() => generate(directory), {code: 'ELOOP'});
});

test('YAML conversion rejects duplicate keys, nonresources, cycles and lossy scalar encodings', () => {
  for (const text of ['kind: Pod\nkind: Service\n', '[]\n', '17\n', '---\n', 'x: &x [*x]\n', 'date: 2024-01-01\n', 'n: .inf\n', 'n: 1.5\n', 'n: 9007199254740993\n']) {
    assert.throws(() => project(Buffer.from(text)));
  }
  assert.throws(() => project(Buffer.from([0xff])), TypeError);
  assert.throws(() => project(Buffer.alloc(1024 * 1024 + 1)), /bounded/);
  assert.throws(() => project(Buffer.from(Array(65).fill('kind: Pod').join('\n---\n'))), /count/);
});

test('canonical encoding preserves all keys, order and JSON scalar types without prototype omission', () => {
  const value = JSON.parse('{"__proto__":{"x":1},"z":[true,false,null,0,"001"],"a":"é"}');
  assert.equal(canonical(value).toString(), '{"__proto__":{"x":1},"a":"é","z":[true,false,null,0,"001"]}\n');
  assert.deepEqual(JSON.parse(project(Buffer.from('kind: ConfigMap\ndata: null\n'))), [{data: null, kind: 'ConfigMap'}]);
  for (const value of [undefined, NaN, -0, new Date(), new Map()]) assert.throws(() => canonical(value));
  const sparse = Array(2), extra = [1]; extra.extra = 2;
  const accessor = {}; Object.defineProperty(accessor, 'x', {enumerable: true, get() { throw Error('getter must not execute'); }});
  for (const value of [sparse, extra, accessor, {[Symbol('x')]: 1}]) assert.throws(() => canonical(value), assert.AssertionError);
  let deep = {}; for (let i = 0; i < 66; i++) deep = {child: deep};
  assert.throws(() => canonical(deep), /structure/);
});

test('tool pin multiplicity, section and installed npm resolved/integrity are closed', t => {
  const directory = fixture(t), tools = readFileSync(join(directory, 'tools.lock'), 'utf8');
  const pin = tools.match(/^ingress_nginx_kind_manifest = .+$/m)[0];
  for (const text of [tools.replace(pin, pin + '\n' + pin), tools.replace(pin, pin + '\n  ' + pin), tools.replace('[target-adapters]', '[wrong-section]'), tools.replace(pin, pin + '\n\'ingress_nginx_kind_manifest\' = "duplicate"')]) {
    writeFileSync(join(directory, 'tools.lock'), text);
    assert.throws(() => generate(directory), assert.AssertionError);
  }
  writeFileSync(join(directory, 'tools.lock'), tools);
  const lockPath = join(directory, 'sdk/oracles/package-lock.json'), original = readFileSync(lockPath);
  for (const key of ['version', 'resolved', 'integrity']) {
    const lock = JSON.parse(original); lock.packages['node_modules/js-yaml'][key] = 'changed';
    writeFileSync(lockPath, JSON.stringify(lock)); assert.throws(() => generate(directory), assert.AssertionError);
  }
});

test('held parent publication refuses namespace replacement without touching a foreign directory', t => {
  const directory = fixture(t), original = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, destination) => {
    if (String(source).startsWith('/proc/self/fd/') && String(source).endsWith('.tmp')) {
      assert(!injected); injected = true;
      original(join(directory, 'adapters'), join(directory, 'adapters-owned-moved'));
      mkdirSync(join(directory, 'adapters'));
      writeFileSync(join(directory, 'adapters/foreign'), 'untouched');
    }
    return original(source, destination);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => generate(directory, true), /parent namespace changed/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert(injected);
  assert.deepEqual(fs.readdirSync(join(directory, 'adapters')), ['foreign']);
  assert.equal(readFileSync(join(directory, 'adapters/foreign'), 'utf8'), 'untouched');
  assert(!fs.readdirSync(join(directory, 'adapters-owned-moved')).some(name => name.endsWith('.tmp')));
});

test('primary write failure survives close failure and retires only its temporary file', t => {
  const directory = fixture(t), before = readFileSync(join(directory, jsonPath));
  const write = fs.writeSync, close = fs.closeSync; let failed = false;
  fs.writeSync = (...args) => { write(...args); failed = true; throw Error('primary write fault'); };
  fs.closeSync = (...args) => { close(...args); if (failed) throw Error('secondary close fault'); };
  syncBuiltinESMExports();
  try { assert.throws(() => generate(directory, true), error => error.message === 'primary write fault'); }
  finally { fs.writeSync = write; fs.closeSync = close; syncBuiltinESMExports(); }
  assert(failed); assert(before.equals(readFileSync(join(directory, jsonPath))));
  assert(!fs.readdirSync(join(directory, 'adapters')).some(name => name.endsWith('.tmp')));
});
