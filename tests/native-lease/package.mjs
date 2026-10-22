// Execute the captured generated package, not a handwritten native runtime.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bytes, command} from '../../scripts/product-sdk-check.mjs';
import {rustCorpus} from './rust-corpus.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const packageFiles = ['Cargo.lock', 'Cargo.toml', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'generation-manifest.json', 'src/lib.rs'];
export function consumerEnvironment(source, temporary, toolchain) {
  assert.match(toolchain, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(source.CARGO_PROFILE_DEV_DEBUG, undefined);
  assert.equal(source.CARGO_INCREMENTAL, undefined);
  // This owner runs inside the pinned Linux SDK, not an ambient host toolchain.
  // An allowlist also excludes dynamic-loader injection and home-level config.
  const env = {PATH: '/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    RUSTUP_HOME: '/usr/local/rustup', HOME: temporary, LANG: 'C.UTF-8'};
  env.CARGO_HOME = join(temporary, 'cargo');
  env.CARGO_TARGET_DIR = join(temporary, 'target');
  env.CARGO_NET_OFFLINE = 'true'; env.CARGO_TERM_COLOR = 'never';
  env.RUSTUP_TOOLCHAIN = toolchain;
  return env;
}
function files(root, path = '') {
  const directory = lstatSync(join(root, path));
  assert(directory.isDirectory() && !directory.isSymbolicLink(), 'generated package directory alias');
  const result = [];
  for (const name of readdirSync(join(root, path)).sort()) {
    const relative = path ? `${path}/${name}` : name;
    const stat = lstatSync(join(root, relative));
    assert(!stat.isSymbolicLink(), 'generated package alias');
    if (stat.isDirectory()) result.push(...files(root, relative));
    else { assert(stat.isFile() && stat.nlink === 1); result.push(relative); }
  }
  return result.sort();
}
export function verifyConsumerOutput(output, index) {
  assert.equal(index.cases.length, 93);
  const expected = ['all_nine_generated_signatures', ...index.cases.map(row => `case_${row.name}`)].sort();
  const observed = output.split('\n').filter(line => line.startsWith('test ') && line.endsWith(' ... ok'))
    .map(line => line.slice(5, -7)).sort();
  assert.deepEqual(observed, expected, 'complete actual generated-package case inventory');
  assert(output.includes('test result: ok. 94 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;'));
  assert.equal(output.split('\n').filter(line => line.startsWith('test result:')).length, 1);
}

export async function verifyPackage(root) {
  const packageRoot = join(root, 'stdlib/generated/package');
  assert.deepEqual(files(packageRoot), packageFiles);
  const captured = new Map(packageFiles.map(path => [path, bytes(join(packageRoot, path), 8 * 1024 * 1024)]));
  const corpusPath = join(root, 'stdlib/src/Foundation/Native/Application/V1/lease-corpus.json');
  const corpusBytes = bytes(corpusPath, 2 * 1024 * 1024);
  const toolchainBytes = bytes(join(root, 'rust-toolchain.toml'), 4096);
  const channels = [...toolchainBytes.toString().matchAll(/^channel = "([0-9]+\.[0-9]+\.[0-9]+)"$/gm)];
  assert.equal(channels.length, 1, 'one exact registered Rust toolchain');
  const index = JSON.parse(corpusBytes), source = rustCorpus(index);
  const manifest = JSON.parse(captured.get('generation-manifest.json'));
  assert.equal(manifest.schema, 'lean4-prod/cargo-package-manifest/1');
  assert.equal(manifest.module, 'PrismPM'); assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.files.map(row => row.path).sort(), packageFiles.filter(path => path !== 'generation-manifest.json'));
  for (const row of manifest.files) {
    assert.deepEqual(Object.keys(row).sort(), ['path', 'sha256']);
    assert.equal(hash(captured.get(row.path)), row.sha256);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'prismpm-native-package-'));
  // A fresh target belongs only to this consumer; no shared build success marker.
  try {
    const env = consumerEnvironment(process.env, temporary, channels[0][1]);
    for (const [path, content] of captured) {
      const destination = join(temporary, 'subject', path);
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, content);
    }
    mkdirSync(join(temporary, 'tests'));
    writeFileSync(join(temporary, 'tests/lease.rs'), source);
    writeFileSync(join(temporary, 'Cargo.toml'), '[package]\nname="native-lease-consumer"\nversion="0.0.0"\nedition="2021"\n'
      + '[workspace]\n[dependencies]\nnative_subject={package="prism-stdlib",path="subject",default-features=false}\n'
      + '[features]\ndefault=["std"]\nstd=["native_subject/std"]\n');
    const cargo = '/usr/local/cargo/bin/cargo';
    await command(cargo, ['generate-lockfile', '--offline'], {cwd: temporary, env, timeout: 300000});
    const arguments_ = ['test', '--locked', '--offline', '--test', 'lease'];
    for (const mode of ['std', 'no_std']) {
      const args = mode === 'std' ? arguments_ : [...arguments_, '--no-default-features'];
      const result = await command(cargo, [...args, '--', '--test-threads=1'], {cwd: temporary, env, timeout: 300000});
      process.stderr.write(result.stdout); process.stderr.write(result.stderr);
      verifyConsumerOutput(result.stdout, index);
      process.stderr.write(`native package ${mode}: 93 explicit cases and all nine signatures passed\n`);
    }
    // A wrong expectation must fail in the executed consumer, not at compilation.
    const wrong = structuredClone(index); wrong.cases[1].expected.error = 'Busy';
    assert.equal(index.cases[1].name, 'open_application_0');
    writeFileSync(join(temporary, 'tests/lease.rs'), rustCorpus(wrong));
    const mutant = await command(cargo, [...arguments_, '--', '--test-threads=1'], {
      cwd: temporary, env, timeout: 300000, status: 101,
    });
    process.stderr.write(mutant.stdout); process.stderr.write(mutant.stderr);
    assert(mutant.stdout.includes('test case_open_application_0 ... FAILED'));
    assert(mutant.stdout.includes('93 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out;'));
    assert(mutant.stdout.includes('left: Err(BadState)'));
    assert(mutant.stdout.includes('right: Err(Busy)'));
    assert(!mutant.stderr.includes('could not compile'));
    for (const [path, content] of captured) {
      assert.deepEqual(bytes(join(packageRoot, path)), content, 'source package changed');
      assert.deepEqual(bytes(join(temporary, 'subject', path)), content, 'private subject changed');
    }
    assert.deepEqual(bytes(corpusPath), corpusBytes);
    assert.deepEqual(bytes(join(root, 'rust-toolchain.toml')), toolchainBytes);
    assert.deepEqual(files(packageRoot), packageFiles);
    return {scope: 'generated-package-corpus-only', cases: 93, signatures: 9, modes: ['std', 'no_std'],
      runtime_mutants: 1, package_manifest_sha256: hash(captured.get('generation-manifest.json')),
      corpus_sha256: hash(corpusBytes)};
  } finally { rmSync(temporary, {recursive: true, force: true}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2);
  console.log(JSON.stringify(await verifyPackage(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))));
}
