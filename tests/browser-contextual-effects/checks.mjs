import assert from 'node:assert/strict';
import {lstatSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as effects from '../../sdk/browser/effects.mjs';
import {prepare as prepareEffects} from '../browser-effects/compile.mjs';
import {prepare as prepareCustody} from '../browser-custody/compile.mjs';
import {corpus as effectCorpus, boundaryCorpus, maximumCorpus as effectMaximum} from '../browser-effects/corpus.mjs';
import {corpus as custodyCorpus, maximumCorpus as custodyMaximum} from '../browser-custody/corpus.mjs';
import {executeWasm as executeEffects, verifyInventory as effectInventory, tsv} from '../browser-effects/checks.mjs';
import {executeWasm as executeCustody, verifyInventory as custodyInventory} from '../browser-custody/checks.mjs';
import {run, sha} from '../browser-view/compile.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {verifyTranscriptDecoder} from './transcript.mjs';
import {verifyBrowser, verifyHostMutations} from './browser.mjs';

const draft = dirname(fileURLToPath(import.meta.url)), repository = resolve(draft, '../..');
const roots = ['stdlib/src', 'sdk/browser', ...['checks.mjs','transcript.mjs','browser.mjs','browser-fixture.mjs']
  .map(file => 'tests/browser-contextual-effects/' + file), 'tests/browser-effects', 'tests/browser-custody',
  'tests/browser-view', 'tests/browser-workspace/src/main.rs', 'tests/browser-journal/driver/src/main.rs',
  'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml', 'model/authorities.toml',
  'model/browser-effect-diagnostics.json', 'model/browser-custody-diagnostics.json', 'lean-toolchain',
  'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE', 'vendor/lean4-prod/lean.tar'];
export function frozenInputs() {
  const files = new Map();
  function capture(relative) {
    const path = join(repository, relative), metadata = lstatSync(path);
    assert.ok(!metadata.isSymbolicLink(), 'no input aliases');
    if (metadata.isDirectory()) {
      for (const name of readdirSync(path).sort()) { assert.ok(!['target','.lake','.prism'].includes(name), 'no private cache in source'); capture(relative + '/' + name); }
      return;
    }
    assert.ok(metadata.isFile() && metadata.size <= 67108864, 'bounded actual input');
    const value = sha(readFileSync(path));
    if (files.has(relative)) assert.equal(files.get(relative), value); else files.set(relative, value);
  }
  for (const path of roots) capture(path);
  for (const vendor of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    capture(vendor + '/MANIFEST.sha256');
    for (const line of readFileSync(join(repository, vendor, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
      const matched = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(matched);
      assert.ok(matched[2].split('/').every(part => part && part !== '.' && part !== '..'));
      const relative = vendor + '/' + matched[2]; capture(relative); assert.equal(files.get(relative), matched[1]);
    }
  }
  return Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right)));
}

function verifyCaptured(build, owner, baseline) {
  assert.deepEqual(frozenInputs(), baseline, 'all original owner inputs remained byte-exact');
  for (const [module, bytes] of build.sources) {
    const relative = (module === 'Fixture' ? 'tests/browser-' + owner : 'stdlib') + '/src/' + module.split('.').join('/') + '.lex.tex';
    assert.equal(sha(bytes), baseline[relative], 'actual compiler source buffer matches entry baseline ' + relative);
    assert.deepEqual(readFileSync(join(build.work, 'project/src', ...module.split('.')) + '.lex.tex'), bytes, 'actual staged source input');
  }
  for (const [relative, expected] of Object.entries(baseline)) {
    if ((relative.startsWith('vendor/lexlean/') || relative.startsWith('vendor/lean4-prod/rust/')) && !relative.endsWith('/MANIFEST.sha256')
      || relative.startsWith('tests/browser-' + owner + '/driver/'))
      assert.equal(sha(readFileSync(join(build.work, relative))), expected, 'actual staged compiler buffer ' + relative);
  }
  for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) assert.equal(sha(readFileSync(join(build.work, 'generated', name))), baseline[name], 'actual generated license input');
}

async function prepare(t, owner, baseline) {
  assert.deepEqual(frozenInputs(), baseline, 'whole owner closure before compiler preparation');
  const isEffects = owner === 'effects', build = (isEffects ? prepareEffects : prepareCustody)();
  verifyCaptured(build, owner, baseline);
  assert.equal(build.cacheRetirement?.owner, owner, 'completed owning compiler retirement required');
  assert.equal(build.cacheRetirement.scope, 'completed-private-tool-caches-only');
  assert.deepEqual(JSON.parse(readFileSync(join(build.work, 'compiler-cache-retirement.json'))), build.cacheRetirement);
  build.retirement = build.cacheRetirement;
  const vectors = isEffects ? [...effectCorpus(), ...boundaryCorpus()] : custodyCorpus();
  assert.equal(vectors.length, isEffects ? 242 : 90);
  assert.ok(!isEffects || vectors.some(row => row.id === 'Exhausted'), 'actual generated counter-exhaustion case included');
  const maximum = (isEffects ? effectMaximum : custodyMaximum)();
  const file = join(build.work, 'contextual-vectors.tsv'); writeFileSync(file, tsv(vectors), {flag:'wx'});
  const binaries = maximum.map((row, index) => {
    const input = join(build.work, 'contextual-maximum-' + index + '.request'), output = join(build.work, 'contextual-maximum-' + index + '.response');
    writeFileSync(input, row.request, {flag:'wx'}); writeFileSync(output, row.response, {flag:'wx'}); return {input, output};
  });
  for (const standard of [true, false]) await prerequisite(t, 'complete ' + owner + ' vectors and maxima in generated ' + (standard ? 'std' : 'no_std'), () => {
    const executable = build.compileNative(standard);
    assert.match(run(executable, [file], build.runner), new RegExp('PASS ' + vectors.length + ' complete ' + owner + ' vectors twice'));
    for (const row of binaries) assert.match(run(executable, ['--binary', row.input, row.output], build.runner), /PASS binary complete (?:effects|custody) vector twice/);
  });
  await prerequisite(t, 'complete ' + owner + ' vectors and declared maxima in generated Wasm', () => {
    build.maximum = (isEffects ? executeEffects : executeCustody)(build.wasmBytes, [...vectors, ...maximum.filter(row => !row.nativeOnly)]);
  });
  verifyCaptured(build, owner, baseline);
  build.evidence = {source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    wasm: sha(build.wasmBytes), ...(isEffects ? {guest: sha(build.guestBytes)} : {}), maximum: build.maximum,
    vectors: vectors.length, maxima: maximum.map(row => ({id:row.id, request:sha(row.request), response:sha(row.response)})),
    retirement: build.retirement};
  writeFileSync(join(build.work, 'contextual-' + owner + '-evidence.json'), JSON.stringify(build.evidence, null, 2) + '\n', {flag:'wx'});
  return build;
}

export async function verifyContextualEffects(t) {
  assert.equal(typeof effects.openContextualStagedEffects, 'function',
    'DK-37 requires the actual private exact-request factory');
  const baseline = frozenInputs(); let effectsBuild, custodyBuild;
  await prerequisite(t, 'closed inherited diagnostic and actual source primitive inventory', () => { effectInventory(); custodyInventory(); });
  await prerequisite(t, 'lossless observed frame restoration rejects malformed or substituted bytes', verifyTranscriptDecoder);
  await prerequisite(t, 'fresh source-owned Effects dependency and exact frozen compiler closure', async child => { effectsBuild = await prepare(child, 'effects', baseline); });
  await prerequisite(t, 'fresh source-owned Custody dependency and exact frozen compiler closure', async child => { custodyBuild = await prepare(child, 'custody', baseline); });
  await prerequisite(t, 'actual contextual browser execution and native replay', child => verifyBrowser(child, effectsBuild, custodyBuild));
  const mutations = await verifyHostMutations(t, effectsBuild, custodyBuild);
  await prerequisite(t, 'complete immutable source closure at final contextual acceptance', () => {
    verifyCaptured(effectsBuild, 'effects', baseline); verifyCaptured(custodyBuild, 'custody', baseline);
  });
  const evidence = {scope:'private-exact-effect-staging-only', publicApplicationAccepted:false,
    sources:baseline, effects:effectsBuild.evidence, custody:custodyBuild.evidence,
    browser:sha(readFileSync(join(effectsBuild.work, 'contextual-browser-evidence.json'))), mutations};
  writeFileSync(join(effectsBuild.work, 'contextual-effects-acceptance.json'), JSON.stringify(evidence, null, 2) + '\n', {flag:'wx'});
  t.diagnostic('retained exact contextual acceptance ' + effectsBuild.work + ' and ' + custodyBuild.work);
}
