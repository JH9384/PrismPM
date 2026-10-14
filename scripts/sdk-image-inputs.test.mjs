// Internal image-input wiring checks. No test fixture is SDK acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildImage, captureImageInputs, dockerArguments, inputPolicy, prepareImageInputs, stageImageInputs } from './sdk-image-inputs.mjs';
import { validateImageInputMetadata } from '../sdk/inventory-metadata.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) + '\n';
const env = () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Image input fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Image input fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z' });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: env() }).trim();

function fixture(t) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-image-input-test-'));
  t.after(() => {
    const writable = directory => {
      chmodSync(directory, 0o700);
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (lstatSync(path).isDirectory()) writable(path);
      }
    };
    writable(work); rmSync(work, { recursive: true });
  });
  const source = join(work, 'source'), advisory = join(work, 'advisory');
  for (const directory of [source, advisory]) {
    mkdirSync(directory); git(directory, 'init', '--quiet', '--template=');
    writeFileSync(join(directory, 'data'), 'unit transport fixture, not acceptance\n');
    git(directory, 'add', '.'); git(directory, 'commit', '--quiet', '-m', 'fixture: initial');
  }
  git(source, 'tag', '-a', 'v0.2.0', '-m', 'fixture historical tag');
  const historical = git(source, 'rev-parse', 'HEAD'), tag = git(source, 'rev-parse', 'v0.2.0');
  mkdirSync(join(source, 'sdk')); mkdirSync(join(source, 'scripts'));
  for (const name of ['sdk-vv-inputs.mjs', 'sdk-image-inputs.mjs']) {
    cpSync(new URL(`./${name}`, import.meta.url), join(source, 'scripts', name));
  }
  cpSync(new URL('../sdk/Dockerfile', import.meta.url), join(source, 'sdk/Dockerfile'));
  const bootstrap = join(work, 'bootstrap.tar.gz');
  writeFileSync(bootstrap, 'synthetic pinned transport bytes, NOT a historical SDK\n');
  writeFileSync(join(source, 'tools.lock'), '[bootstrap-sdk]\nversion = "0.2.0"\n'
    + `source_commit = "${historical}"\ntag_object = "${tag}"\n`
    + 'url = "https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz"\n'
    + `sha256 = "${hash(readFileSync(bootstrap))}"\n`);
  writeFileSync(join(source, 'sdk/vv-inputs.lock.json'), canonical({ schema: 'prismpm/sdk-image-input-authorities/1', advisory: {
    url: 'https://github.com/RustSec/advisory-db', revision: git(advisory, 'rev-parse', 'HEAD'), tree: git(advisory, 'rev-parse', 'HEAD^{tree}') } }));
  chmodSync(join(source, 'data'), 0o755); symlinkSync('data', join(source, 'alias'));
  git(source, 'add', '.'); git(source, 'commit', '--quiet', '-m', 'fixture: image inputs');
  // Neither an unrelated file nor caller credentials/config may enter the image.
  writeFileSync(join(source, 'untracked-secret'), 'fixture secret must not be copied\n');
  git(source, 'config', 'remote.origin.url', 'https://fixture-token@example.invalid/private');
  const revision = git(source, 'rev-parse', 'HEAD');
  const capture = destination => captureImageInputs({ source, revision, advisory, bootstrap, destination });
  return { work, source, revision, advisory, bootstrap, capture };
}

test('every source-derived image COPY consumes the verified committed source stage', () => {
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const unverified = recipe.split('\n').filter(line => line.startsWith('COPY ') && !line.includes('--from='));
  assert.deepEqual(unverified, [
    'COPY scripts/sdk-vv-inputs.mjs scripts/sdk-image-inputs.mjs /opt/input-policy/scripts/',
    'COPY sdk/Dockerfile sdk/vv-inputs.lock.json /opt/input-policy/sdk/',
    'COPY tools.lock /opt/input-policy/',
  ], 'only the bound verifier bootstrap may enter from the raw context');
  assert.match(recipe, /COPY --from=vv-inputs \/ \/opt\/prismpm\/share\/vv-inputs\//);
  assert.match(recipe, /SDK_SOURCE_REVISION/);
});

function imageStages(recipe) {
  const stages = new Map(); let current;
  for (const line of recipe.replace(/\\\n\s*/g, ' ').split('\n')) {
    const from = /^FROM (\S+) AS (\S+)$/.exec(line);
    if (from) { current = { base: from[1], instructions: [] }; stages.set(from[2], current); }
    else if (current && line && !line.startsWith('#')) current.instructions.push(line);
  }
  return stages;
}

const rustTools = [
  ['wasm-bindgen-cli', '0.2.122'], ['wasm-tools', '1.258.0'],
  ['wasmtime-cli', '48.0.1'], ['cargo-local-registry', '0.2.12'],
];
const rustToolTarget = '/opt/prismpm/rust-oracle-target';
const rustToolInstalls = rustTools.map(([name, version]) =>
  `cargo install --locked --target-dir ${rustToolTarget} ${name} --version ${version}`);
const rustToolInitialization = `test ! -e ${rustToolTarget} && mkdir -p -m 0700 ${rustToolTarget}`;
const rustToolConstruction = `${rustToolInitialization} && ${rustToolInstalls.join(' && ')} && rm -rf ${rustToolTarget}`;

function checkedRustToolConstruction(recipe) {
  const instructions = recipe.replace(/[ \t]*\\\n[ \t]*/g, ' ').split('\n');
  const installs = instructions.filter(line => line.includes('cargo install '));
  assert.deepEqual(installs, [`RUN ${rustToolConstruction}`], 'all four real locked installations share one fresh same-layer target');
  assert.equal(instructions.filter(line => line.includes(rustToolTarget)).length, 1, 'no retained or cross-layer target');
  assert(!instructions.some(line => /^(ENV|ARG) .*CARGO_(?:BUILD_)?TARGET_DIR/.test(line)), 'no ambient target override');
  return installs[0].slice(4);
}

test('both existing recipes keep four exact installations in one fresh layer-local target', () => {
  for (const path of ['../.devcontainer/Dockerfile', '../sdk/Dockerfile']) {
    const recipe = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/[ \t]*\\\n[ \t]*/g, ' ');
    checkedRustToolConstruction(recipe);
    const mutants = [
      recipe.replace(`${rustToolInitialization} && `, ''),
      recipe.replace(`test ! -e ${rustToolTarget} && `, ''),
      recipe.replace('mkdir -p -m 0700', 'mkdir -p -m 0777'),
      recipe.replace('mkdir -p -m 0700', 'mkdir -m 0700'),
      recipe.replace('--locked ', ''),
      recipe.replace('wasm-bindgen-cli --version 0.2.122', 'wasm-bindgen-cli --version 0.2.121'),
      recipe.replace('--locked --target-dir', '--locked --root /tmp/foreign-install --target-dir'),
      recipe.replaceAll(`--target-dir ${rustToolTarget}`, '--target-dir /tmp/ambient-target'),
      recipe.replace(`${rustToolInstalls[0]} && ${rustToolInstalls[1]}`, `${rustToolInstalls[1]} && ${rustToolInstalls[0]}`),
      recipe.replace(rustToolInstalls[0], `${rustToolInstalls[0]} && ${rustToolInstalls[0]}`),
      recipe + `\nRUN ${rustToolInstalls[0]}\n`,
      recipe.replace(` && rm -rf ${rustToolTarget}`, ''),
      recipe.replace(` && rm -rf ${rustToolTarget}`, `\nRUN rm -rf ${rustToolTarget}`),
      recipe.replace(`RUN test ! -e ${rustToolTarget}`, `RUN --mount=type=cache,target=${rustToolTarget} test ! -e ${rustToolTarget}`),
      recipe.replace('RUN test ! -e', 'RUN true || test ! -e'),
      recipe.replace(rustToolInitialization, rustToolInitialization.replace(' && ', '; ')),
      recipe + '\nENV CARGO_TARGET_DIR=/tmp/ambient-target\n',
      recipe + '\nARG CARGO_BUILD_TARGET_DIR=/tmp/ambient-target\n',
      recipe + `\nCOPY --from=input_tools ${rustToolTarget} ${rustToolTarget}\n`,
      ...rustToolInstalls.map(command => recipe.replace(command, command.replace(`--target-dir ${rustToolTarget} `, ''))),
    ];
    for (const mutant of mutants) {
      assert.notEqual(mutant, recipe, 'each planted mutation must alter the actual recipe');
      assert.throws(() => checkedRustToolConstruction(mutant));
    }
  }
});

test('actual layer-local target initialization creates private parents and refuses every retained target', t => {
  const root = mkdtempSync(join(tmpdir(), 'rust-tool-target-init-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [index, path] of ['../.devcontainer/Dockerfile', '../sdk/Dockerfile'].entries()) {
    const recipe = readFileSync(new URL(path, import.meta.url), 'utf8');
    const command = checkedRustToolConstruction(recipe);
    const initialization = command.split(' && cargo install ')[0];
    assert.equal(initialization, rustToolInitialization);
    const run = (target, source = initialization) => {
      const quoted = "'" + target.replaceAll("'", "'\\''") + "'";
      return spawnSync('/bin/sh', ['-eu', '-c', source.replaceAll(rustToolTarget, quoted)], {
        stdio: 'pipe', encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
      });
    };
    const passed = result => {assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);};
    const refused = result => {assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.notEqual(result.status, 0);};
    for (const missingParents of [false, true]) {
      const parent = join(root, String(index), String(missingParents), 'parent');
      if (!missingParents) mkdirSync(parent, {recursive: true});
      const target = join(parent, 'target');
      if (missingParents) refused(run(target, initialization.replace('mkdir -p -m 0700', 'mkdir -m 0700')));
      passed(run(target));
      const before = lstatSync(target, {bigint: true});
      assert(before.isDirectory() && !before.isSymbolicLink());
      assert.equal(before.mode & 0o777n, 0o700n);
      refused(run(target));
      passed(run(target, initialization.replace(`test ! -e ${rustToolTarget} && `, '')));
      const after = lstatSync(target, {bigint: true});
      for (const key of ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key]);
    }
    const foreign = join(root, String(index), 'foreign');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'retained-bytes'), 'must remain unchanged\n');
    const alias = join(root, String(index), 'alias'); symlinkSync(foreign, alias);
    refused(run(alias));
    assert.equal(readlinkSync(alias), foreign);
    assert.equal(readFileSync(join(foreign, 'retained-bytes'), 'utf8'), 'must remain unchanged\n');
    const absent = join(root, String(index), 'absent');
    const dangling = join(root, String(index), 'dangling'); symlinkSync(absent, dangling);
    refused(run(dangling));
    assert.equal(readlinkSync(dangling), absent); assert(!existsSync(absent));
    const regular = join(root, String(index), 'regular'); writeFileSync(regular, 'retained regular input\n');
    refused(run(regular)); assert.equal(readFileSync(regular, 'utf8'), 'retained regular input\n');
    const fifo = join(root, String(index), 'fifo'); execFileSync('mkfifo', [fifo]);
    refused(run(fifo)); assert(lstatSync(fifo).isFIFO());
  }
});

test('pinned tool layers exclude source inputs while the build retains both verified closure and policy', t => {
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const checkTopology = text => {
    const stages = imageStages(text), tools = stages.get('input_tools'), build = stages.get('build');
    assert(tools, 'independent pinned tool stage required');
    assert.match(tools.base, /^docker\.io\/library\/rust:[^@]+@sha256:[0-9a-f]{64}$/);
    assert(!tools.instructions.some(line => /^(COPY|ADD) |SDK_SOURCE_REVISION|\/prepared|vv-inputs/.test(line)), 'tool stage cannot inherit caller source');
    assert.equal(stages.get('source_inputs').base, 'input_tools');
    assert.equal(build.base, 'input_tools', 'tool installation cannot inherit the source stage');
    const retained = build.instructions.filter(line => line.startsWith('COPY --from=source_inputs /opt/prismpm/share/'));
    assert.deepEqual(retained, [
      'COPY --from=source_inputs /opt/prismpm/share/vv-inputs/ /opt/prismpm/share/vv-inputs/',
      'COPY --from=source_inputs /opt/prismpm/share/vv-input-policy.json /opt/prismpm/share/vv-input-policy.json',
    ]);
    const lastTool = build.instructions.findIndex(line => line.startsWith('RUN case ') && line.includes('slsa_arch='));
    assert(lastTool >= 0 && build.instructions.indexOf(retained[0]) > lastTool);
    assert(build.instructions.indexOf(retained[1]) < build.instructions.findIndex(line => line.includes('node sdk/generate-inventory.mjs')));
    return retained;
  };
  const retained = checkTopology(recipe);
  assert.throws(() => checkTopology(recipe.replace('FROM input_tools AS build', 'FROM source_inputs AS build')));
  for (const instruction of retained) assert.throws(() => checkTopology(recipe.replace(instruction, '')));

  // Execute the selected filesystem-copy semantics over a genuinely verified
  // Git closure; this fixture is not a Docker build or installed SDK claim.
  const f = fixture(t), closure = join(f.work, 'closure'), policy = f.capture(closure);
  stageImageInputs(closure, f.source, f.revision, join(f.work, 'verified'));
  const share = join(f.work, 'source-share'); mkdirSync(share);
  cpSync(closure, join(share, 'vv-inputs'), { recursive: true });
  cpSync(join(f.work, 'verified/policy.json'), join(share, 'vv-input-policy.json'));
  const executeCopies = (instructions, output) => {
    mkdirSync(output);
    for (const instruction of instructions) {
      const [verb, from, source, destination] = instruction.split(' ');
      assert.equal(verb, 'COPY'); assert.equal(from, '--from=source_inputs');
      const prefix = '/opt/prismpm/share/'; assert(source.startsWith(prefix) && destination.startsWith(prefix));
      cpSync(join(share, source.slice(prefix.length)), join(output, destination.slice(prefix.length)), { recursive: true });
    }
    assert.equal(readFileSync(join(output, 'vv-input-policy.json'), 'utf8'), canonical(policy));
    for (const path of readdirSync(closure)) assert.deepEqual(readFileSync(join(output, 'vv-inputs', path)), readFileSync(join(closure, path)));
  };
  executeCopies(retained, join(f.work, 'retained'));
  for (let index = 0; index < retained.length; index++) {
    assert.throws(() => executeCopies(retained.filter((_, row) => row !== index), join(f.work, `omitted-${index}`)), /ENOENT/);
  }
});

test('real Git image inputs stage raw committed bytes without Git metadata or caller secrets', t => {
  const f = fixture(t), closure = join(f.work, 'closure'), second = join(f.work, 'closure-two');
  const policy = f.capture(closure); f.capture(second);
  for (const name of readdirSync(closure)) assert.deepEqual(readFileSync(join(closure, name)), readFileSync(join(second, name)), name);
  const destination = join(f.work, 'staged');
  const manifest = stageImageInputs(closure, f.source, f.revision, destination);
  assert.deepEqual(manifest.policy, policy);
  assert.deepEqual(readdirSync(destination).sort(), ['policy.json', 'source']);
  assert(!existsSync(join(destination, 'source/.git')));
  assert(!existsSync(join(destination, 'source/untracked-secret')));
  assert.equal(readlinkSync(join(destination, 'source/alias')), 'data');
  assert.deepEqual(readFileSync(join(destination, 'source/data')), readFileSync(join(f.source, 'data')));
  assert.equal(readFileSync(join(destination, 'policy.json'), 'utf8'), canonical(policy));
  for (const name of readdirSync(closure)) assert(!readFileSync(join(closure, name)).includes('fixture-token'));
  assert.throws(() => stageImageInputs(closure, f.source, f.revision, destination), /fresh|exist/);
});

test('stage rejects changed source, authority, bootstrap and coherent policy substitution before output', t => {
  const f = fixture(t), closure = join(f.work, 'closure'); f.capture(closure);
  assert.throws(() => stageImageInputs(closure, f.source, 'f'.repeat(40), join(f.work, 'wrong-source')));
  assert(!existsSync(join(f.work, 'wrong-source')));
  const lock = join(f.source, 'sdk/vv-inputs.lock.json'), original = readFileSync(lock);
  const changed = JSON.parse(original); changed.advisory.revision = 'e'.repeat(40);
  writeFileSync(lock, canonical(changed));
  assert.throws(() => stageImageInputs(closure, f.source, f.revision, join(f.work, 'wrong-policy')));
  assert(!existsSync(join(f.work, 'wrong-policy'))); writeFileSync(lock, original);
  for (const name of ['manifest.json', 'bootstrap.tar.gz', 'source.pack', 'advisory.pack']) {
    const path = join(closure, name), bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from('x')]));
    assert.throws(() => stageImageInputs(closure, f.source, f.revision, join(f.work, 'bad-input')));
    assert(!existsSync(join(f.work, 'bad-input'))); writeFileSync(path, bytes);
  }
  for (const relative of ['scripts/sdk-image-inputs.mjs', 'scripts/sdk-vv-inputs.mjs', 'sdk/Dockerfile']) {
    const script = join(f.source, relative), bytes = readFileSync(script);
    writeFileSync(script, Buffer.concat([bytes, Buffer.from('\n// uncommitted input\n')]));
    assert.throws(() => stageImageInputs(closure, f.source, f.revision, join(f.work, 'wrong-helper')));
    assert(!existsSync(join(f.work, 'wrong-helper'))); writeFileSync(script, bytes);
  }
});

test('authority parsing is closed and never selects a floating or alternate advisory source', t => {
  const f = fixture(t), lock = join(f.source, 'sdk/vv-inputs.lock.json'), original = readFileSync(lock);
  const authority = JSON.parse(original);
  for (const changed of [
    { ...authority, schema: 'unregistered/1' }, { ...authority, extra: true },
    { ...authority, advisory: { ...authority.advisory, revision: 'main' } },
    { ...authority, advisory: { ...authority.advisory, tree: '0'.repeat(39) } },
    { ...authority, advisory: { ...authority.advisory, url: 'https://example.invalid/advisories' } },
    { ...authority, advisory: { ...authority.advisory, refresh: true } },
  ]) {
    writeFileSync(lock, canonical(changed)); assert.throws(() => inputPolicy(f.source, f.revision));
  }
  writeFileSync(lock, original);
  const tools = join(f.source, 'tools.lock'), pinned = readFileSync(tools, 'utf8');
  for (const changed of [pinned + 'sha256 = "' + 'a'.repeat(64) + '"\n', pinned + 'fallback = true\n',
    pinned.replace('version = "0.2.0"', 'version = "latest"'), pinned.replace('https://github.com/', 'http://github.com/')]) {
    writeFileSync(tools, changed); assert.throws(() => inputPolicy(f.source, f.revision));
  }
});

test('real acquisition dispatch isolates environment and disables user curl configuration', t => {
  const f = fixture(t), bin = join(f.work, 'acquisition-bin'), home = join(f.work, 'curl-home'), record = join(f.work, 'acquisition.json');
  mkdirSync(bin); mkdirSync(home);
  writeFileSync(join(home, '.curlrc'), 'unregistered-prismpm-test-option = true\n');
  const actualGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const actualCurl = execFileSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).trim();
  const curlEnvironment = { PATH: process.env.PATH, HOME: home, CURL_HOME: home };
  assert.match(spawnSync(actualCurl, ['--version'], { env: curlEnvironment, encoding: 'utf8' }).stderr,
    /unregistered-prismpm-test-option/, 'real curl must observe the planted configuration without --disable');
  const common = `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({tool:require('node:path').basename(process.argv[1]),args,env:process.env})+'\\n');\n`;
  writeFileSync(join(bin, 'git'), common + `const selected=args[0]==='fetch'?['fetch','--quiet','--depth=1',${JSON.stringify('file://' + f.advisory)},args.at(-1)]:args;const result=cp.spawnSync(${JSON.stringify(actualGit)},selected,{stdio:'inherit',env:{...process.env,GIT_ALLOW_PROTOCOL:'file'}});process.exit(result.status??1);\n`, { mode: 0o755 });
  // Only transport is replaced with local data. The real acquisition function
  // selects all arguments; real Git and curl still execute those boundaries.
  writeFileSync(join(bin, 'curl'), common + `const at=args.indexOf('--output');const bounded=args.filter((value,index)=>index!==at&&index!==at+1&&!value.startsWith('https://'));const result=cp.spawnSync(${JSON.stringify(actualCurl)},[...bounded,'--version'],{encoding:'utf8',env:${JSON.stringify(curlEnvironment)}});if(result.stderr.includes('unregistered-prismpm-test-option'))process.exit(81);if(result.status!==0)process.exit(result.status??1);fs.copyFileSync(${JSON.stringify(f.bootstrap)},args[at+1]);\n`, { mode: 0o755 });
  const injected = { PATH: `${bin}:${process.env.PATH}`, CURL_HOME: home, GIT_CONFIG_PARAMETERS: 'invalid fixture config',
    HTTPS_PROXY: 'https://fixture.invalid', PRISMPM_TEST_SECRET: 'unit-only secret' };
  const previous = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(injected)) process.env[key] = value;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const policy = prepareImageInputs(f.source, f.revision, join(f.work, 'acquired'));
  assert.deepEqual(policy, inputPolicy(f.source, f.revision));
  const observed = records(record).filter(row => row.tool === 'curl' || ['init', 'fetch', 'checkout'].includes(row.args[0]));
  assert.deepEqual(observed.map(row => row.tool), ['git', 'git', 'git', 'curl']);
  for (const row of observed) {
    assert.deepEqual(Object.keys(row.env).sort(), ['GIT_ALLOW_PROTOCOL', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
      'GIT_NO_REPLACE_OBJECTS', 'GIT_TERMINAL_PROMPT', 'LANG', 'LC_ALL', 'PATH'].sort());
    assert.equal(row.env.GIT_ALLOW_PROTOCOL, 'https');
  }
  assert.deepEqual(observed[1].args, ['fetch', '--quiet', '--depth=1', 'https://github.com/RustSec/advisory-db', policy.advisory_revision]);
  const curl = observed[3].args;
  assert.equal(curl[0], '--disable');
  assert.deepEqual(curl.slice(1, 10), ['--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--fail', '--location', '--silent', '--show-error']);
  assert.equal(curl[curl.indexOf('--max-filesize') + 1], '67108864');
});

test('real FIFO policy and metadata inputs fail before a potentially blocking open', t => {
  const f = fixture(t), fifo = join(f.work, 'metadata-fifo');
  execFileSync('mkfifo', [fifo]);
  const helper = new URL('./sdk-image-inputs.mjs', import.meta.url).pathname;
  const invoke = args => {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined, 'FIFO rejection must not rely on the test killing a blocked reader');
    assert.equal(result.signal, null); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bounded regular input required/);
  };
  invoke([helper, 'digest', fifo]);
  const lock = join(f.source, 'sdk/vv-inputs.lock.json'); rmSync(lock); execFileSync('mkfifo', [lock]);
  invoke(['--input-type=module', '-e', `import {inputPolicy} from ${JSON.stringify(pathToFileURL(helper).href)}; inputPolicy(${JSON.stringify(f.source)},${JSON.stringify(f.revision)});`]);
});

function stageInstruction(recipe) {
  const instructions = recipe.replace(/\\\n\s*/g, ' ').split('\n');
  const rows = instructions.filter(line => line.startsWith('RUN node /opt/input-policy/scripts/sdk-image-inputs.mjs stage '));
  assert.equal(rows.length, 1, 'one unconditional stage invocation');
  return rows[0].slice(4);
}

test('the actual Docker staging instruction executes and an omitted verifier fails', t => {
  const f = fixture(t), share = join(f.work, 'share'); mkdirSync(share); f.capture(join(share, 'vv-inputs'));
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const command = stageInstruction(recipe).replaceAll('/opt/input-policy', f.source)
    .replaceAll('/opt/prismpm/share', share).replaceAll('/prepared', join(f.work, 'prepared'));
  const run = script => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    env: { ...env(), SDK_SOURCE_REVISION: f.revision }, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
  const result = run(command); assert.equal(result.status, 0, result.stderr);
  assert(!existsSync(join(f.work, 'prepared/source/.git')));
  assert.equal(JSON.parse(readFileSync(join(share, 'vv-input-policy.json'))).source_revision, f.revision);
  rmSync(join(f.work, 'prepared'), { recursive: true });
  const omitted = command.replace(/^node .*? && /, 'true && ');
  assert.notEqual(omitted, command);
  assert.notEqual(run(omitted).status, 0, 'missing stage cannot publish policy/source');
  assert(!existsSync(join(f.work, 'prepared')));
});

function recordingDocker(t, work) {
  const bin = join(work, 'bin'); mkdirSync(bin);
  const record = join(work, 'docker.json');
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const value=args[args.indexOf('--build-context')+1];fs.appendFileSync(process.env.IMAGE_DOCKER_RECORD,JSON.stringify({args,files:fs.readdirSync(value.slice('vv-inputs='.length))})+'\\n');const at=args.indexOf('--metadata-file');if(at>=0)fs.writeFileSync(args[at+1],JSON.stringify({'containerimage.digest':'sha256:'+'a'.repeat(64)}));process.exit(Number(process.env.IMAGE_DOCKER_STATUS??0));\n`, { mode: 0o755 });
  const prior = { PATH: process.env.PATH, IMAGE_DOCKER_RECORD: process.env.IMAGE_DOCKER_RECORD, IMAGE_DOCKER_STATUS: process.env.IMAGE_DOCKER_STATUS };
  process.env.PATH = `${bin}:${process.env.PATH}`; process.env.IMAGE_DOCKER_RECORD = record;
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return record;
}

const records = path => readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));

test('build wrapper prepares and verifies real inputs before invoking Docker exactly once and preserves failure', t => {
  const f = fixture(t), record = recordingDocker(t, f.work);
  let calls = 0;
  const prepare = (source, revision, destination) => {
    assert.equal(source, f.source); assert.equal(revision, f.revision); calls++; return f.capture(destination);
  };
  const args = ['--no-cache', '--platform', 'linux/amd64', '--output', 'type=oci,dest=fixture.tar', '--provenance=false', '--sbom=false', '--build-arg', 'SOURCE_DATE_EPOCH=0'];
  assert.equal(buildImage(f.source, f.revision, 'runtime', args, prepare), 0);
  const [observed] = records(record); assert.equal(records(record).length, 1); assert.equal(calls, 1);
  assert.deepEqual(observed.files.sort(), ['advisory.pack', 'bootstrap.tar.gz', 'manifest.json', 'source.pack']);
  const context = observed.args[observed.args.indexOf('--build-context') + 1].slice('vv-inputs='.length);
  assert.deepEqual(observed.args, dockerArguments(f.source, f.revision, 'runtime', context, args));
  assert(!existsSync(context), 'owned context is removed after Docker returns');
  process.env.IMAGE_DOCKER_STATUS = '23';
  assert.equal(buildImage(f.source, f.revision, 'runtime', args, prepare), 23);
  assert.equal(calls, 2); assert.equal(records(record).length, 2); delete process.env.IMAGE_DOCKER_STATUS;
  rmSync(record);
  assert.throws(() => buildImage(f.source, f.revision, 'runtime', args, () => inputPolicy(f.source, f.revision)));
  assert(!existsSync(record), 'omitted acquisition cannot reach Docker');
});

test('a planted successful Docker omission is caught by the executable wrapper check', async t => {
  const f = fixture(t), record = recordingDocker(t, f.work), module = join(f.work, 'mutant.mjs');
  cpSync(new URL('./sdk-vv-inputs.mjs', import.meta.url), join(f.work, 'sdk-vv-inputs.mjs'));
  const source = readFileSync(new URL('./sdk-image-inputs.mjs', import.meta.url), 'utf8');
  const mutant = source.replace("const result = spawnSync('docker', argv, { stdio: 'inherit' });", 'const result = { status: 0, signal: null };');
  assert.notEqual(mutant, source); writeFileSync(module, mutant);
  const changed = await import(pathToFileURL(module));
  const assertInvoked = implementation => {
    assert.equal(implementation(f.source, f.revision, 'runtime', [], (_source, _revision, destination) => f.capture(destination)), 0);
    assert.equal(records(record).length, 1, 'one real transport invocation');
  };
  assert.throws(() => assertInvoked(changed.buildImage), /ENOENT/);
  assertInvoked(buildImage);
});

test('all SDK targets preserve accepted flags and reject conflicting source/context/file/target overrides', () => {
  const revision = '1'.repeat(40);
  for (const target of ['runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles', 'cli-archive']) {
    const result = dockerArguments('/fixture/source', revision, target, '/fixture/inputs', ['--load', '--tag', 'fixture:only']);
    assert.equal(result[result.indexOf('--target') + 1], target);
    assert.equal(result[result.indexOf('--build-arg') + 1], `SDK_SOURCE_REVISION=${revision}`);
    assert.equal(result.at(-1), '/fixture/source');
  }
  for (const args of [ ['--build-context', 'vv-inputs=/other'], ['--build-arg', 'SDK_SOURCE_REVISION=' + '2'.repeat(40)],
    ['--build-arg=SDK_SOURCE_REVISION=' + revision], ['--file', 'other'], ['-f', 'other'], ['--target', 'other'], ['.'],
    ['--platform'], ['--output', ''], ['--output', '--build-context'], ['--label', '--file'],
    ['--build-arg', 'SOURCE_DATE_EPOCH=123'], ['--provenance=true'] ]) {
    assert.throws(() => dockerArguments('/fixture/source', revision, 'runtime', '/fixture/inputs', args), JSON.stringify(args));
  }
  assert.throws(() => dockerArguments('/fixture/source', revision, 'unregistered', '/fixture/inputs', []));
});

test('inventory binds actual sealed data and source policy/helpers without mutable checkout metadata', t => {
  const f = fixture(t), closure = join(f.work, 'closure'), policy = f.capture(closure);
  const bytes = readFileSync(join(closure, 'manifest.json')), manifest = JSON.parse(bytes), policyDigest = `sha256:${hash(canonical(policy))}`;
  const artifacts = [
    ...[['sdk-vv-source', policy.source_revision, 'source.pack'], ['sdk-vv-advisory', policy.advisory_revision, 'advisory.pack'],
      ['sdk-vv-bootstrap', '0.2.0', 'bootstrap.tar.gz'], ['sdk-vv-manifest', '1', 'manifest.json']]
      .map(([id, version, path]) => ({ id, version, kind: 'test-corpus', digest: `sha256:${hash(readFileSync(join(closure, path)))}` })),
    { id: 'sdk-vv-policy', version: '1', kind: 'test-corpus', digest: policyDigest },
    ...[['sdk-vv-verifier', 'scripts/sdk-vv-inputs.mjs'], ['sdk-image-input-verifier', 'scripts/sdk-image-inputs.mjs'],
      ['sdk-image-input-authorities', 'sdk/vv-inputs.lock.json']].map(([id, path]) => ({ id, version: '1', kind: 'test-corpus', digest: `sha256:${hash(readFileSync(join(f.source, path)))}` })),
  ];
  const validate = rows => validateImageInputMetadata(rows, policy, manifest, `sha256:${hash(bytes)}`, policyDigest);
  validate(artifacts);
  for (let index = 0; index < artifacts.length; index++) {
    assert.throws(() => validate(artifacts.filter((_, i) => i !== index)));
    assert.throws(() => validate([...artifacts, artifacts[index]]));
    assert.throws(() => validate(artifacts.map((row, i) => i === index ? { ...row, digest: 'sha256:' + 'f'.repeat(64) } : row)));
    assert.throws(() => validate(artifacts.map((row, i) => i === index ? { ...row, version: 'unbound' } : row)));
  }
  for (const mutate of [
    value => value.artifacts.push({ ...value.artifacts[0] }),
    value => value.artifacts.pop(),
    value => value.artifacts.push({ ...value.artifacts[0], path: 'extra.pack' }),
    value => { value.artifacts[0].extra = true; },
    value => { value.artifacts[0].byte_length = -1; },
    value => { value.artifacts[0].byte_length = 268435457; },
    value => { value.artifacts[1].byte_length = 67108865; },
    value => { value.artifacts[0].sha256 = 'unbound'; },
  ]) {
    const changed = structuredClone(manifest); mutate(changed);
    const digest = `sha256:${hash(canonical(changed))}`;
    const resealed = artifacts.map(row => row.id === 'sdk-vv-manifest' ? { ...row, digest } : row);
    assert.throws(() => validateImageInputMetadata(resealed, policy, changed, digest, policyDigest));
  }
});

function runBlock(source, marker) {
  const start = source.indexOf(marker); assert(start >= 0, `caller missing: ${marker}`);
  const lines = source.slice(start).split('\n');
  const at = lines.findIndex(line => /^        run: \|$/.test(line)); assert(at >= 0);
  const selected = [];
  for (const line of lines.slice(at + 1)) {
    if (line && !line.startsWith('          ')) break;
    selected.push(line.slice(10));
  }
  return selected.join('\n');
}

function unitCallerTransport(t, f) {
  const record = recordingDocker(t, f.work), bin = join(f.work, 'bin');
  // This executable intercepts the *actual caller shell arguments*. Only
  // acquisition uses explicitly synthetic local Git inputs; Docker records
  // transport arguments and cannot build/publish an image in this unit test.
  const shim = `#!${process.execPath}\nimport fs from 'node:fs';import assert from 'node:assert/strict';import path from 'node:path';
const [script,command,...args]=process.argv.slice(2);
assert.equal(path.basename(script),'sdk-image-inputs.mjs');
assert.equal(fs.readFileSync(script,'utf8'),fs.readFileSync(${JSON.stringify(new URL('./sdk-image-inputs.mjs', import.meta.url).pathname)},'utf8'));
const m=await import(${JSON.stringify(new URL('./sdk-image-inputs.mjs', import.meta.url).href)});
if(command==='build'){const [source,revision,target,...options]=args;process.exitCode=m.buildImage(source,revision,target,options,(s,r,destination)=>m.captureImageInputs({source:path.resolve(s),revision:r,advisory:${JSON.stringify(f.advisory)},bootstrap:${JSON.stringify(f.bootstrap)},destination}));}
else if(command==='digest'){const value=JSON.parse(fs.readFileSync(args[0]));assert.match(value['containerimage.digest'],/^sha256:[0-9a-f]{64}$/);console.log(value['containerimage.digest']);}
else throw Error('unexpected caller invocation');\n`;
  // .mjs ensures top-level await; the shim named node is just a shell exec.
  writeFileSync(join(bin, 'node-shim.mjs'), shim);
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' '${join(bin, 'node-shim.mjs')}' "$@"\n`, { mode: 0o755 });
  const output = join(f.work, 'github-output');
  const environment = { ...env(), GITHUB_SHA: f.revision, GITHUB_REPOSITORY: 'UOR-Foundation/PrismPM',
    RUNNER_TEMP: f.work, GITHUB_OUTPUT: output, ARCHITECTURE: 'amd64', PLATFORM: 'linux/amd64',
    TARGET: 'runtime', DOCKERFILE: 'sdk/Dockerfile', REPOSITORY: 'fixture-registry.invalid/sdk', VERSION: '0.3.0' };
  return { record, output, run: (script, cwd = f.source) => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    cwd, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 }) };
}

test('each real SDK workflow/local caller executes the checked wrapper and preserves its Docker outputs', t => {
  const f = fixture(t), transport = unitCallerTransport(t, f);
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const candidate = readFileSync(new URL('../.github/workflows/sdk-candidate.yml', import.meta.url), 'utf8');
  const vv = readFileSync(new URL('./vv.sh', import.meta.url), 'utf8').replace(/\\\n\s*/g, ' ');
  const localBuild = vv.split('\n').find(line => line.trimStart().startsWith('node scripts/sdk-image-inputs.mjs build '));
  assert(localBuild, 'local full VV image construction must use the common wrapper');
  // Execute the actual per-session tag definitions too. Extracting only the
  // build line would omit its shell inputs, not test the real local caller.
  const assignments = ['nonce', 'local_sdk_tag'].map(name => {
    const matches = vv.split('\n').filter(line => line.trimStart().startsWith(`${name}=`));
    assert.equal(matches.length, 1, `one local SDK ${name} assignment`);
    return matches[0];
  });
  const local = [...assignments, localBuild].join('\n');
  const native = runBlock(release.slice(release.indexOf('  native:')), '      - shell: bash')
    .split('\n  archive=')[0].split('\narchive=')[0];
  const rows = [
    ['candidate', runBlock(candidate, '      - name: Build the production image recipe'), 'runtime', 'type=oci,'],
    ['release', runBlock(release, '      - id: build'), 'runtime', 'type=registry,'],
    ['native', native, 'cli-archive', 'type=local,'],
    ['local-vv', local, 'runtime', null],
  ];
  for (const [name, command, target, outputPrefix] of rows) {
    if (existsSync(transport.record)) rmSync(transport.record);
    const result = transport.run(command); assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const actual = records(transport.record); assert.equal(actual.length, 1, name);
    const args = actual[0].args;
    assert.equal(args[args.indexOf('--target') + 1], target);
    assert.equal(args[args.indexOf('--build-arg') + 1], `SDK_SOURCE_REVISION=${f.revision}`);
    assert.equal(args.at(-1), f.source);
    if (outputPrefix) assert(args[args.indexOf('--output') + 1].startsWith(outputPrefix));
    if (name === 'local-vv') {
      assert(args.includes('--load'));
      const firstTag = args[args.indexOf('--tag') + 1];
      assert.match(firstTag, /^prismpm-vv-sdk:gate-[0-9]+-[0-9]+$/);
      rmSync(transport.record);
      const again = transport.run(command);
      assert.equal(again.status, 0, again.stderr);
      const second = records(transport.record); assert.equal(second.length, 1);
      const secondTag = second[0].args[second[0].args.indexOf('--tag') + 1];
      assert.match(secondTag, /^prismpm-vv-sdk:gate-[0-9]+-[0-9]+$/);
      assert.notEqual(secondTag, firstTag, 'separate sessions must not share a mutable SDK tag');
    }
    if (name === 'release') assert.equal(readFileSync(transport.output, 'utf8'), `digest=sha256:${'a'.repeat(64)}\n`);
    rmSync(transport.record);
    // A successful skipped command is not a successful test of the caller.
    const skipped = transport.run(`if false; then\n${command}\nfi`);
    assert.equal(skipped.status, 0); assert(!existsSync(transport.record));
    assert.throws(() => records(transport.record), /ENOENT/);
    const changed = command.replaceAll('"$GITHUB_SHA"', '"' + 'e'.repeat(40) + '"')
      .replace('"$(git rev-parse HEAD)"', '"' + 'e'.repeat(40) + '"');
    assert.notEqual(changed, command, name);
    assert.notEqual(transport.run(changed).status, 0); assert(!existsSync(transport.record));
  }
  // Execute the unchanged build portion of the real two-root workflow loop.
  const full = runBlock(release.slice(release.indexOf('  reproducibility:')), '      - shell: bash');
  const start = full.indexOf('for root in root-a root-b; do');
  const end = full.indexOf('\n  mkdir "$root.oci"', start); assert(start >= 0 && end > start);
  const loop = full.slice(start, end) + '\ndone\n';
  cpSync(f.source, join(f.work, 'root-a'), { recursive: true, verbatimSymlinks: true });
  cpSync(f.source, join(f.work, 'root-b'), { recursive: true, verbatimSymlinks: true });
  const result = transport.run(loop, f.work); assert.equal(result.status, 0, result.stderr);
  const actual = records(transport.record); assert.equal(actual.length, 2);
  assert.deepEqual(actual.map(row => row.args.at(-1)), [join(f.work, 'root-a'), join(f.work, 'root-b')]);
  for (const row of actual) assert(row.args.includes('--no-cache') && row.args.includes('--provenance=false') && row.args.includes('--sbom=false'));
});
