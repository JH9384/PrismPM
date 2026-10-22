import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {repository, sourceClosure, frozenInputs, requirePreparedComponent, run, sha, verifyFrozenInputs,
  assertComponentCompilerInputs} from './compile.mjs';
import {mutations, mutateSource, mutationProbes} from './mutations.mjs';
import {inputClosureAdversaries, matchingPackageManifest} from './adversaries.mjs';
import {profileLinkCases} from './profile-links.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';

test('matching manifest probes reach captured identity instead of failing canonical encoding', t => {
  // Synthetic generator output tests the actual package guard, not a compiler
  // substitute or evidence for the separately required complete HO15 owner.
  const work = mkdtempSync(join(tmpdir(), 'prismpm-primary-manifest-probe-'));
  t.after(() => rmSync(work, {recursive:true, force:true}));
  const paths = ['Cargo.lock', 'Cargo.toml', 'LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'src/lib.rs'];
  const files = paths.map(path => {
    const bytes = Buffer.from('synthetic package fixture: ' + path + '\n');
    mkdirSync(dirname(join(work, path)), {recursive:true}); writeFileSync(join(work, path), bytes, {flag:'wx'});
    return {path,sha256:sha(bytes)};
  });
  const inputIrSha256 = sha(Buffer.from('synthetic test IR'));
  // Deliberately unsorted keys verify recursive canonical serialization.
  const manifest = {schema:'lean4-prod/cargo-package-manifest/1', module:'Fixture',
    input_ir_sha256:inputIrSha256, files, dependencies:[]};
  const original = matchingPackageManifest(Buffer.from(JSON.stringify(manifest)), 'src/lib.rs', readFileSync(join(work, 'src/lib.rs')));
  const path = join(work, 'generation-manifest.json'); writeFileSync(path, original, {flag:'wx'});
  const captured = captureGeneratedPackage(work, {kind:'native', inputIrSha256}); captured.verify();
  const changed = Buffer.from('coherently substituted generated source\n');
  writeFileSync(join(work, 'src/lib.rs'), changed);
  const forged = matchingPackageManifest(original, 'src/lib.rs', changed); writeFileSync(path, forged);
  captureGeneratedPackage(work, {kind:'native', inputIrSha256}).verify();
  assert.throws(() => captured.verify(), /immutable generated package captured immediately after code generation/);
  writeFileSync(path, forged.subarray(0, forged.length - 1));
  assert.throws(() => captured.verify(), /canonical generated manifest bytes/);
  assert.throws(() => matchingPackageManifest(original, 'omitted', changed), /one declared substitution target/);
  const duplicated = JSON.parse(original); duplicated.files.push(duplicated.files.find(row => row.path === 'src/lib.rs'));
  assert.throws(() => matchingPackageManifest(Buffer.from(JSON.stringify(duplicated)), 'src/lib.rs', changed),
    /one declared substitution target/);
});

test('component uses exact source modules and cannot adopt a caller receipt', () => {
  const sources = sourceClosure();
  assert.equal(sources.size, 12);
  assert.ok(sources.has('Foundation.Holo.V1.PrimaryWire'));
  assert.ok(sources.has('Foundation.Browser.Application.V1.SessionWire'));
  assert.throws(() => requirePreparedComponent({verified:true,wasm:new Uint8Array()}), /actual fresh owning compiler/);
});

test('seven actual source mutants change only the selected PrimaryWire module', () => {
  assert.equal(mutations.length, 7);
  for (const mutation of mutations) {
    const before = sourceClosure(), changed = sourceClosure();
    assert.equal(mutateSource(changed, mutation.id), mutation);
    assert.deepEqual([...changed.keys()], [...before.keys()]);
    let modified = 0;
    for (const [name, bytes] of changed) {
      if (!bytes.equals(before.get(name))) {assert.equal(name, 'Foundation.Holo.V1.PrimaryWire'); modified++;}
    }
    assert.equal(modified, 1);
  }
});

test('complete mutation-probe inventory refuses missing and duplicate probes before compilation', () => {
  const rows = mutations.map(mutation => ({id: mutation.probe}));
  assert.deepEqual(mutationProbes(rows), rows);
  for (const row of rows) {
    assert.throws(() => mutationProbes(rows.filter(value => value !== row)), /exact codec probe/);
    assert.throws(() => mutationProbes([...rows, row]), /exact codec probe/);
  }
  assert.equal(mutations.find(row => row.id === 'sorted-blobs').probe, 'BlobOrder102');
});

test('captured graph rejects five actual transitive defects without writing the source tree', () => {
  const inputs = frozenInputs();
  const observed = inputClosureAdversaries(inputs);
  assert.equal(observed.cases.length, 5);
  assert.deepEqual(observed.inputs, inputs);
  verifyFrozenInputs(inputs);
});

test('private substitution entry refuses direct invocation against repository or SDK inputs', () => {
  const inputs = frozenInputs();
  assert.throws(() => run(process.execPath,
    [join(repository, 'tests/holo-primary-component/adversaries.mjs'), '--private-input-checks'], repository),
  /private input-copy parent/);
  verifyFrozenInputs(inputs);
});

test('owning input inventory includes external oracle, generated artifact guards and whole dynamic entry closure', () => {
  const inputs = frozenInputs();
  for (const path of ['tests/holo-primary-component/owner.test.mjs', 'tests/holo-primary-component/checks.mjs',
    'tests/holo-primary-component/oracle.rs', 'vendor/hologram-live.tar', 'tests/hologram-oracle/Cargo.lock',
    'tests/holo-primary-component/profile-links.mjs',
    'tests/browser-view/generated-package.mjs', 'tests/browser-view/generated-wasm.mjs',
    'tests/browser-session-journal/runtime.mjs', 'tests/browser-effects/corpus.mjs'])
    assert.match(inputs[path], /^[a-f0-9]{64}$/, path);
  const source = readFileSync(join(repository, 'tests/holo-primary-component/oracle.rs'), 'utf8');
  assert.match(source, /catalog\.import\("source-session\.holo"\.into\(\), archive\.clone\(\)\)/);
});

test('independent profile-link negative inventory retains all reference and source seams', () => {
  assert.equal(profileLinkCases.length,24);
  assert.equal(new Set(profileLinkCases.map(row=>row.id)).size,24);
  for(const expected of ['model_content_kappa','guest_content_kappa','capabilities_content_kappa',
    'application_kappa','source equality','source facts','module input closure','IR equality',
    'package closure equality','metadata shape','provenance shape','authority revisions','guest SHA-256'])
    assert.ok(profileLinkCases.some(row=>row.expected===expected),expected);
});

test('primary component input custody refuses copied maps and missing transitive files', () => {
  const inputs = frozenInputs(); verifyFrozenInputs(inputs);
  assert.throws(() => verifyFrozenInputs(Object.freeze({...inputs})), /actual complete captured input inventory/);
  const omitted = {...inputs}; delete omitted['tests/browser-view/compiler-owner.mjs'];
  assert.throws(() => verifyFrozenInputs(Object.freeze(omitted)), /actual complete captured input inventory/);
});

test('primary component compiler binding refuses fabricated handles before execution', () => {
  for (const owner of [null, {}, {evidence: {family: 'holo-primary-component', inputs: {}}},
    {runDriver() {throw Error('caller compiler executed');}}])
    assert.throws(() => assertComponentCompilerInputs(owner, {}), /actual fresh compiler owner/);
});
