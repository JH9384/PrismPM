// Source/type check only. Full proof/native/Wasm/DOM acceptance remains required.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'prismpm-semantic-source-'));
const modules = ['Fixture', 'Foundation.Bytes', 'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive',
  'Foundation.View.Browser.V1.Model', 'Foundation.View.Browser.V1.Wire',
  'Foundation.View.Browser.V1.Design', 'Foundation.View.Browser.V1.DesignWire', 'Foundation.View.Browser.V1.Semantics',
  'Foundation.View.Browser.V1.SemanticsWire'].sort();
const frozen = [];
const write = (path, bytes) => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, bytes, {flag: 'wx'}); };
const stage = (relative, destination) => {
  const source = join(root, relative), bytes = readFileSync(source);
  frozen.push({source, hash: sha(bytes)}); write(destination, bytes); return bytes;
};
try {
  const dependencies = readFileSync(join(root, 'model/dependencies.toml'), 'utf8')
    .split('[[dependency.artifact]]').slice(1).map(section => {
      const record = section.split('[[dependency]]')[0];
      return {path: /^path = "([^"]+)"$/m.exec(record)?.[1], hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(record)?.[1]};
    });
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const relative = tree + '/MANIFEST.sha256', bytes = readFileSync(join(root, relative));
    const rows = dependencies.filter(row => row.path === relative); assert.equal(rows.length, 1);
    assert.equal(sha(bytes), rows[0].hash, relative);
    const seen = new Set();
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      const [, digest, path] = row;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(path)); seen.add(path);
      assert.equal(sha(stage(`${tree}/${path}`, join(work, tree, path))), digest, path);
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    stage(`tests/browser-presentation/driver/${relative}`, join(work, 'tests/browser-presentation/driver', relative));
  }
  stage('rust-toolchain.toml', join(work, 'rust-toolchain.toml'));
  const project = join(work, 'project');
  for (const module of modules) {
    const relative = 'src/' + module.replaceAll('.', '/') + '.lex.tex';
    stage((module === 'Fixture' ? 'tests/browser-semantic-presentation/' : 'stdlib/') + relative, join(project, relative));
  }
  const configuration = readFileSync(join(root, 'tests/fixtures/library/native-library/project/lexlean.toml'), 'utf8')
    .replace('name = "library-probe"', 'name = "semantic-presentation-source"')
    .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
    .replace('entrypoints = ["src/Probe.lex.tex"]', 'entrypoints = ["src/Fixture.lex.tex"]');
  write(join(project, 'lexlean.toml'), configuration);
  write(join(project, 'lakefile.toml'), 'name = "semantic_presentation_source"\nversion = "0.1.0"\n');
  stage('lean-toolchain', join(project, 'lean-toolchain'));
  const target = join(work, 'driver-target');
  execFileSync('cargo', ['build', '--locked', '--offline', '--manifest-path',
    join(work, 'tests/browser-presentation/driver/Cargo.toml')], {
    cwd: work, env: {...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '1',
      CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0'},
    stdio: ['ignore', 'inherit', 'inherit'], timeout: 300_000,
  });
  const checked = JSON.parse(execFileSync(join(target, 'debug/browser-presentation-driver'),
    ['check', join(project, 'lexlean.toml')], {cwd: work, encoding: 'utf8', timeout: 120_000}));
  assert.deepEqual(checked.modules, modules);
  for (const {source, hash} of frozen) assert.equal(sha(readFileSync(source)), hash, source);
  console.log(JSON.stringify({scope: 'source-type-check-only', ...checked}));
} finally {
  rmSync(work, {recursive: true, force: true});
}
