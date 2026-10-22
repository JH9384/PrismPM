// AU-07: external structural-oracle qualification, not application conformance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureFile, captureTree, sha} from './capture.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const crate = 'sdk/oracles/oscal';
const unitTests = [
  'input::tests::raw_container_children_borrow_the_original_subject',
  'input::tests::actual_maximum_bytes_and_nesting_preserve_the_complete_payload',
  'input::tests::actual_item_and_numeric_boundaries_return_resource_outcomes',
  'input::tests::exact_numbers_reserved_keys_and_resource_refusals',
  'input::tests::stable_capture_rejects_real_path_inode_link_and_content_substitution',
  'input::tests::capture_is_bounded_before_and_after_open',
  'tests::all_draft7_and_four_format_cases',
  'tests::all_official_cross_edition_documents',
  'tests::strict_json_duplicates_and_invalid_bytes',
  'tests::all_seven_local_models_and_subject_mutations',
  'tests::fragment_reference_diagnostic',
  'tests::subject_numbers_are_not_rounded_before_schema_validation',
].sort();
const cliTests = [
  'real_cli_binds_subject_bytes_and_distinguishes_resource_refusal',
  'real_cli_preserves_full_valid_byte_boundary_and_refuses_resource_excess',
].sort();
const definitions = [
  {name: 'invalid-acceptance', file: 'src/main.rs',
    before: '(self.0[schema].is_valid(value) && self.0["complete"].is_valid(value)).then_some(*root)',
    after: 'Some(*root)', test: 'tests::all_seven_local_models_and_subject_mutations',
    diagnostic: 'invalid local subject:'},
  {name: 'wrong-edition', file: 'src/main.rs',
    before: '(value[root]["metadata"]["oscal-version"] == "1.1.0").then_some(root)',
    after: 'Some(root)', test: 'tests::all_official_cross_edition_documents',
    diagnostic: 'wrong edition:'},
  {name: 'unstable-capture', file: 'src/input.rs',
    before: /fn same\(left: &fs::Metadata, right: &fs::Metadata\) -> bool \{[\s\S]*?\n\}/,
    after: 'fn same(_left: &fs::Metadata, _right: &fs::Metadata) -> bool { true }',
    test: 'input::tests::stable_capture_rejects_real_path_inode_link_and_content_substitution',
    diagnostic: 'same-byte inode substitution at stage 0'},
  {name: 'unavailable-schema', file: 'src/main.rs',
    before: 'add46ade21dc1659f7bac0e83637a9270ba1468ebf6bbd26ac0c6085d2eb0e67',
    after: '0'.repeat(64), unavailable: true},
];

function write(path, bytes, mode = 0o400) {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  writeFileSync(path, bytes, {flag: 'wx', mode});
}

function environment(work, toolchain) {
  for (const name of Object.keys(process.env)) assert.ok(
    !/^(?:RUSTFLAGS|RUSTDOCFLAGS|RUSTC(?:_|$)|RUSTDOC$|CARGO_ENCODED_|CARGO_PROFILE_|CARGO_BUILD_|CARGO_TARGET_.*_(?:RUSTFLAGS|LINKER|RUNNER)$|NODE_OPTIONS$|NODE_PATH$|LD_PRELOAD$|LD_LIBRARY_PATH$|BASH_ENV$|ENV$)/.test(name),
    'inherited compiler override refused: ' + name);
  if (process.env.RUSTUP_TOOLCHAIN) assert.ok(
    [toolchain, toolchain.split('-').slice(0, 1)[0]].includes(process.env.RUSTUP_TOOLCHAIN),
    'wrong inherited Rust toolchain');
  return {PATH: '/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME, RUSTUP_HOME: '/usr/local/rustup', RUSTUP_TOOLCHAIN: toolchain,
    CARGO_HOME: join(work, 'cargo-home'), CARGO_NET_OFFLINE: 'true', CARGO_BUILD_JOBS: '2',
    CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: join(work, 'scratch')};
}

function run(program, args, cwd, env, expected = 0) {
  const result = spawnSync('/usr/bin/timeout', ['--signal=TERM', '--kill-after=5s', '360s', program, ...args],
    {cwd, env, encoding: 'utf8', detached: true, timeout: 370000, killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024});
  if (result.pid) {
    try {process.kill(-result.pid, 'SIGKILL');}
    catch (error) {if (error.code !== 'ESRCH') throw error;}
  }
  assert.ifError(result.error);
  assert.equal(result.status, expected, program + ' ' + args.join(' ') + '\n' + result.stdout + result.stderr);
  return {stdout: result.stdout, stderr: result.stderr, status: result.status};
}

export async function verifyCompleteOscalOracle() {
  assert.equal(process.platform, 'linux', 'pinned Linux devcontainer required');
  const triple = {x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu'}[process.arch];
  assert.ok(triple, 'supported SDK architecture');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-oscal-owner-'));
  for (let ancestor = dirname(work);; ancestor = dirname(ancestor)) {
    for (const name of ['config', 'config.toml']) assert.ok(!existsSync(join(ancestor, '.cargo', name)),
      'unowned ancestor Cargo configuration');
    if (dirname(ancestor) === ancestor) break;
  }
  console.log('OSCAL owning work: ' + work);
  const sources = new Map(), trees = [];
  function addFile(relative) {sources.set(relative, captureFile(join(repository, relative)));}
  for (const relative of [crate, 'tests/oscal-json', 'standards/oracles/oscal-1.1.0',
    'standards/corpora/json-schema-draft7', 'standards/corpora/oscal-content-bae69b5a']) {
    const tree = captureTree(join(repository, relative)); trees.push(tree);
    for (const [path, captured] of tree.files) sources.set(relative + '/' + path, captured);
  }
  for (const relative of ['rust-toolchain.toml', 'SPEC.md', 'model/ids.toml',
    'features/suites/authorities.feature', 'crates/conformance/src/cases/mod.rs',
    'crates/conformance/tests/conformance.rs', 'standards/imports/oscal-json-structural.json',
    'standards/imports/oscal-json-structural.md', 'scripts/fetch-oracle-cargo.sh',
    'scripts/fetch-oracle-cargo.test.mjs']) addFile(relative);
  const rust = /^channel = "([0-9]+\.[0-9]+\.[0-9]+)"$/m.exec(
    sources.get('rust-toolchain.toml').bytes.toString())?.[1];
  assert.ok(rust, 'exact Rust release');
  const env = environment(work, rust + '-' + triple);
  mkdirSync(env.TMPDIR);
  const version = {};
  for (const name of ['rustc', 'cargo']) {
    version[name] = run('/usr/local/cargo/bin/' + name, ['--version', '--verbose'], work, env).stdout;
    assert.equal(/^release: (.+)$/m.exec(version[name])?.[1], rust);
    assert.equal(/^host: (.+)$/m.exec(version[name])?.[1], triple);
  }
  const pin = JSON.parse(sources.get(crate + '/engine.json').bytes);
  const lock = sources.get(crate + '/Cargo.lock').bytes;
  assert.equal(sha(lock), pin.adapter_cargo_lock_sha256);
  assert.equal(sha(sources.get(crate + '/ENGINE-LICENSE').bytes), pin.license_sha256);
  const packages = lock.toString().split('[[package]]').slice(1).map(section => ({
    name: /^name = "([^"]+)"$/m.exec(section)?.[1],
    version: /^version = "([^"]+)"$/m.exec(section)?.[1],
    source: /^source = "([^"]+)"$/m.exec(section)?.[1],
    checksum: /^checksum = "([0-9a-f]{64})"$/m.exec(section)?.[1],
  }));
  assert.equal(packages.length, 95);
  const local = packages.filter(row => !row.source);
  assert.deepEqual(local.map(row => [row.name, row.version]), [['prismpm-oscal-oracle', '0.1.0']]);
  const registry = 'index.crates.io-1949cf8c6b5b557f';
  const originalHome = process.env.CARGO_HOME || join(process.env.HOME, '.cargo');
  const index = captureTree(join(originalHome, 'registry/index', registry));
  for (const [path, capture] of index.files)
    write(join(env.CARGO_HOME, 'registry/index', registry, path), capture.bytes, 0o600);
  const archives = [];
  for (const row of packages.filter(row => row.source)) {
    assert.equal(row.source, 'registry+https://github.com/rust-lang/crates.io-index');
    assert.match(row.name, /^[a-zA-Z0-9_-]+$/); assert.match(row.version, /^[a-zA-Z0-9.+-]+$/);
    const name = row.name + '-' + row.version + '.crate';
    const captured = captureFile(join(originalHome, 'registry/cache', registry, name));
    assert.equal(captured.evidence.sha256, row.checksum, 'published archive checksum: ' + name);
    const destination = join(env.CARGO_HOME, 'registry/cache', registry, name);
    write(destination, captured.bytes, 0o600);
    archives.push({captured, staged: captureFile(destination), name, checksum: row.checksum});
    if (row.name === pin.name) {
      assert.equal(row.version, pin.version); assert.equal(row.checksum, pin.crate_sha256);
      assert.equal(captured.bytes.length, pin.crate_bytes);
    }
  }
  function originals() {
    for (const tree of trees) tree.verify();
    for (const capture of sources.values()) capture.verify();
    index.verify();
    for (const row of archives) {row.captured.verify(); row.staged.verify();}
  }
  function stage(name, mutation = null) {
    const input = join(work, name, 'input');
    for (const [relative, captured] of sources) {
      let bytes = captured.bytes;
      if (mutation && relative === crate + '/' + mutation.file) {
        const text = bytes.toString();
        assert.equal(text.split(mutation.before).length, 2, 'exact defect insertion point');
        bytes = Buffer.from(text.replace(mutation.before, mutation.after));
      }
      write(join(input, relative), bytes);
    }
    return {input, source: captureTree(input), target: join(work, name, 'target')};
  }
  const baseline = stage('baseline');
  const cargoArgs = ['--locked', '--offline', '--manifest-path', join(baseline.input, crate, 'Cargo.toml')];
  const metadata = JSON.parse(run('/usr/local/cargo/bin/cargo',
    ['metadata', ...cargoArgs, '--format-version', '1'], baseline.input, env).stdout);
  assert.equal(metadata.packages.length, packages.length);
  const dependencies = captureTree(join(env.CARGO_HOME, 'registry/src', registry));
  const engineRoot = join(env.CARGO_HOME, 'registry/src', registry, pin.name + '-' + pin.version);
  const vcs = JSON.parse(readFileSync(join(engineRoot, '.cargo_vcs_info.json')));
  assert.equal(vcs.git.sha1, pin.revision); assert.notEqual(vcs.git.dirty, true);
  assert.equal(vcs.path_in_vcs, 'crates/jsonschema');
  assert.equal(sha(readFileSync(join(engineRoot, 'LICENSE'))), pin.license_sha256);
  assert.equal(sha(readFileSync(join(engineRoot, 'Cargo.lock'))), pin.crate_cargo_lock_sha256);
  const results = [];
  function execute(build, name, mutation = null) {
    const buildEnv = {...env, CARGO_TARGET_DIR: build.target};
    function inputs() {originals(); build.source.verify(); dependencies.verify();}
    inputs();
    const compiled = run('/usr/local/cargo/bin/cargo', ['test', '--locked', '--offline',
      '--manifest-path', join(build.input, crate, 'Cargo.toml'), '--no-run', '--message-format=json'],
    build.input, buildEnv);
    write(join(work, name, 'compiler.jsonl'), compiled.stdout);
    write(join(work, name, 'compiler.stderr'), compiled.stderr);
    inputs();
    const artifacts = compiled.stdout.trim().split('\n').map(line => JSON.parse(line))
      .filter(row => row.reason === 'compiler-artifact' && row.executable
        && row.package_id === metadata.packages.find(row => row.name === 'prismpm-oscal-oracle').id.replace(
          baseline.input, build.input));
    const units = artifacts.filter(row => row.profile.test && row.target.kind.includes('bin'));
    const cli = artifacts.filter(row => row.profile.test && row.target.kind.includes('test'));
    const main = artifacts.filter(row => !row.profile.test && row.target.kind.includes('bin'));
    assert.equal(units.length, 1); assert.equal(cli.length, 1); assert.equal(main.length, 1);
    const captured = artifacts.map((row, index) => {
      assert.ok(row.executable.startsWith(build.target + '/'), 'fresh private Cargo output');
      const original = captureFile(row.executable, 268435456, null);
      assert.deepEqual(original.bytes.subarray(0, 4), Buffer.from([127, 69, 76, 70]));
      const path = join(work, name, 'executables', String(index)); write(path, original.bytes, 0o500);
      return {row, original, private: captureFile(path), path};
    });
    function guarded(row, args, expected = 0) {
      const executable = captured.find(item => item.row === row);
      const check = () => {for (const item of captured) {item.original.verify(); item.private.verify();}};
      check(); inputs();
      try {return run(executable.path, args, build.input, buildEnv, expected);}
      finally {check(); inputs();}
    }
    for (const [row, expected] of [[units[0], unitTests], [cli[0], cliTests]]) {
      const listed = guarded(row, ['--list', '--format', 'terse']).stdout.trim().split('\n')
        .filter(line => line.endsWith(': test')).map(line => line.slice(0, -6)).sort();
      assert.deepEqual(listed, expected, 'complete actual test inventory');
    }
    const observations = [];
    if (mutation?.unavailable) {
      const subject = join(work, name, 'subject.json');
      const corpus = JSON.parse(sources.get(crate + '/local-subjects.json').bytes);
      write(subject, JSON.stringify(corpus.positives[0]));
      const result = guarded(main[0], [subject], 6);
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.includes('OSCAL oracle unavailable: changed official OSCAL schema: assessment-plan'));
      observations.push(result);
    } else if (mutation) {
      const result = guarded(units[0], ['--exact', mutation.test, '--nocapture', '--test-threads=1'], 101);
      assert.ok(result.stdout.includes('test ' + mutation.test + ' ... FAILED'));
      assert.ok(result.stderr.includes(mutation.diagnostic), 'intended actual defect counterexample');
      assert.match(result.stdout, /0 passed; 1 failed; 0 ignored; 0 measured; 11 filtered out/);
      observations.push(result);
    } else {
      for (const [row, count] of [[units[0], 12], [cli[0], 2]]) {
        const result = guarded(row, ['--nocapture', '--test-threads=1']);
        assert.ok(result.stdout.includes(`test result: ok. ${count} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;`));
        observations.push(result);
      }
    }
    const evidence = {name, mutationKilled: !!mutation && !mutation.unavailable,
      unavailableOracleRefused: !!mutation?.unavailable, observations,
      artifacts: captured.map(item => ({original: item.row.executable,
        originalIdentity: item.original.evidence, private: item.path, privateIdentity: item.private.evidence}))};
    write(join(work, name, 'receipt.json'), JSON.stringify(evidence, null, 2) + '\n');
    inputs();
    // Exact private Cargo target only. Retained execution copies and receipts survive.
    run('/usr/local/cargo/bin/cargo', ['clean', '--manifest-path', join(build.input, crate, 'Cargo.toml'),
      '--target-dir', build.target], build.input, buildEnv);
    for (const item of captured) item.private.verify();
    results.push(evidence);
  }
  try {
    execute(baseline, 'baseline');
    for (const mutation of definitions) execute(stage(mutation.name, mutation), mutation.name, mutation);
    originals(); dependencies.verify();
    const evidence = {schema: 'prismpm/oscal-structural-owner/1', scope: pin.scope,
      completeStandardAcceptance: false, structuralOwnerPassed: true, version,
      source: Object.fromEntries([...sources].map(([name, row]) => [name, row.evidence])),
      dependencies: archives.map(({name, checksum}) => ({name, checksum})), results};
    write(join(work, 'owner.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('OSCAL structural owner PASS: ' + join(work, 'owner.json'));
    return evidence;
  } catch (error) {
    write(join(work, 'unaccepted.json'), JSON.stringify({structuralOwnerPassed: false, error: String(error)}, null, 2) + '\n');
    throw error;
  }
}
