import assert from 'node:assert/strict';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mutateSource,mutations} from './mutations.mjs';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {captureFile, capturedFile} from '../browser-view/file-custody.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm,requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {captureCompilerArtifact,requireCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {provenanceProfile} from '../browser-presentation/provenance.mjs';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha} from '../browser-view/compile.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
export const modules = Object.freeze(['Fixture', 'Foundation.Browser.Application.V1.Effects', 'Foundation.Browser.Application.V1.EffectsWire',
  'Foundation.Browser.Application.V1.Session', 'Foundation.Browser.Application.V1.SessionWire',
  'Foundation.View.Browser.V1.Model', 'Foundation.View.Browser.V1.Wire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive'].sort());
const modulePath = name => (name === 'Fixture' ? 'tests/browser-session' : 'stdlib') + '/src/' + name.replaceAll('.', '/') + '.lex.tex';
const inputCustody = new WeakMap();
const provenanceContract = provenanceProfile('session');
function freezeRecord(value) {
  if(value && typeof value === 'object') {
    for(const child of Object.values(value))freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

function assertCapturedNames(captured) {
  for (const [path,evidence] of captured) {
    const absolute=join(repository,path), stat=lstatSync(absolute,{bigint:true});
    assert.ok(stat.isFile()&&stat.nlink===1n,'single-link session custody name');
    assert.equal(realpathSync(absolute),absolute,'session custody ancestry');
    for (const key of ['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'])
      assert.equal(stat[key].toString(),evidence[key],'stable final session custody '+path+' '+key);
  }
}

export function frozenInputs() {
  const files = new Set([
    ...modules.map(modulePath),
    ...['checks.mjs','compile.mjs','corpus.mjs','maxima.mjs','maximum-runner.mjs','mutations.mjs','size-corpus.mjs',
      'wire.mjs','wire.test.mjs','provenance.test.mjs','budget.mjs','runner.rs','driver/Cargo.toml','driver/Cargo.lock','driver/src/main.rs'].map(path=>'tests/browser-session/'+path),
    'sdk/browser/session-model-test.mjs','sdk/browser/identity.mjs','sdk/browser/effects-wire.mjs','sdk/browser/effects-module.mjs','sdk/browser/presentation-wire.mjs',
    'tests/browser-view/compile.mjs','tests/browser-view/driver-cache.mjs','tests/browser-view/prerequisites.mjs','tests/browser-effects/corpus.mjs',
    'tests/browser-view/compiler-owner.mjs','tests/browser-view/compiler-artifact.mjs','tests/browser-view/compiler-owner-checks.mjs',
    'tests/browser-view/file-custody.mjs','tests/browser-view/generated-package.mjs','tests/browser-view/generated-wasm.mjs',
    'tests/browser-presentation/provenance.mjs',
    'model/ids.toml','SPEC.md','features/suites/sdk.feature','scripts/browser-api-sdk-check.mjs','scripts/owning-node-reporter.mjs','sdk/stdlib-sources.tar',
    'crates/conformance/src/cases/mod.rs','crates/conformance/tests/conformance.rs',
    'tests/browser-presentation/corpus.mjs','tests/browser-presentation/maximum-fixtures.mjs',
    'tests/browser-workspace/src/main.rs','tests/browser-journal/driver/src/main.rs',
    'tests/fixtures/library/native-library/project/lexlean.toml','rust-toolchain.toml','lean-toolchain',
    'LICENSE-MIT','LICENSE-APACHE','model/authorities.toml','model/dependencies.toml',
    'vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust/MANIFEST.sha256','vendor/lexlean/MANIFEST.sha256',
  ]);
  const captured = new Map();
  const read = path => {
    assert.ok(files.has(path), 'registered complete session input required');
    if (!captured.has(path)) captured.set(path, captureFile(join(repository,path)));
    return captured.get(path).bytes;
  };
  for (const tree of ['vendor/lexlean','vendor/lean4-prod/rust']) {
    for (const line of read(tree+'/MANIFEST.sha256').toString('utf8').trimEnd().split('\n')) {
      const row=/^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      assert.ok(!row[2].startsWith('/') && !row[2].split('/').some(part=>!part||part==='.'||part==='..'),
        'closed registered session vendor path');
      files.add(tree+'/'+row[2]);
    }
  }
  for (const path of files) read(path);
  pins(read);
  // Catch early names changing while later descriptors are read. This final
  // sweep is not an atomic filesystem snapshot and never replaces fresh hashes.
  assertCapturedNames(new Map([...captured].map(([path,row])=>[path,row.evidence])));
  const ordered = [...captured].sort(([left],[right])=>left < right ? -1 : left > right ? 1 : 0);
  const inputs = Object.freeze(Object.fromEntries(ordered.map(([path,row])=>[path,row.evidence.sha256])));
  inputCustody.set(inputs, new Map(ordered.map(([path,row])=>[path,row.evidence])));
  return inputs;
}

export function assertFrozenInputs(expected) {
  const captured = inputCustody.get(expected);
  assert.ok(captured && Object.isFrozen(expected),
    'actual frozen session input closure required; complete frozen session owner inputs');
  assert.deepEqual(expected,Object.fromEntries([...captured].map(([path,evidence])=>[path,evidence.sha256])),
    'complete frozen session owner inputs');
  // The source that defines this inventory, both vendor manifests and their
  // dependency pins are captured members. Re-reading those original members
  // binds membership without recapturing the entire closure a second time.
  const bytes = new Map();
  for (const [path,evidence] of captured) bytes.set(path,capturedFile(join(repository,path),evidence));
  pins(path => {
    assert.ok(bytes.has(path), 'registered complete session pin input required');
    return bytes.get(path);
  });
  assertCapturedNames(captured);
}

function capturedInput(path, inputs) {
  const captured = inputCustody.get(inputs);
  assert.ok(captured?.has(path), 'captured session source input required');
  const bytes=capturedFile(join(repository,path),captured.get(path));
  assert.equal(sha(bytes),inputs[path],'frozen captured source/tool input '+path);
  return bytes;
}

export function assertBaselineSources(actual, expected) {
  assert.ok(expected instanceof Map, 'actual positive source closure required before mutations');
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'complete positive source module inventory');
  for (const [module, bytes] of actual) assert.deepEqual(bytes, expected.get(module), 'immutable positive source before mutation ' + module);
}

function pins(read) {
  const artifacts = read('model/dependencies.toml').toString('utf8')
    .split('[[dependency.artifact]]').slice(1).map(section => {
      const text = section.split('[[dependency]]')[0];
      return {path: /^path = "([^"]+)"$/m.exec(text)?.[1],
        hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],
        tree: /^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
    });
  for (const [name, expectedTree] of [
    ['vendor/lean4-prod/lean.tar', undefined],
    ['vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lean4-prod/rust'],
    ['vendor/lexlean/MANIFEST.sha256', 'vendor/lexlean'],
  ]) {
    const rows = artifacts.filter(row => row.path === name); assert.equal(rows.length, 1);
    const [{hash, tree}] = rows, bytes = read(name);
    assert.equal(tree, expectedTree, 'registered session pin tree');
    assert.equal(sha(bytes), hash, name);
    if (!tree) continue;
    const seen = new Set();
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      const [, digest, path] = row;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(path)); seen.add(path);
      assert.equal(sha(read(join(tree, path))), digest, path);
    }
  }
}

export function prepare(mutation = null, baseline = null, inputs = frozenInputs(), compilerOwner = null) {
  assert.ok(mutation === null || mutations.some(row=>row.id === mutation), 'registered session source mutation required');
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_SESSION_'), 'session acceptance refuses bypass ' + key);
  assertFrozenInputs(inputs);
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, capturedInput(modulePath(name),inputs)]));
  const originals = new Map(sources);
  for (const [module, bytes] of originals) assert.equal(sha(bytes),inputs[modulePath(module)],'frozen captured original source '+module);
  if (mutation !== null) assertBaselineSources(originals, baseline);
  const planted = mutation === null ? null : mutateSource(sources, mutation);
  const compiler = compilerOwner === null ? createCompilerOwner('session',captureCompilerInputs('session'))
    : requireCompilerOwner(compilerOwner,'session');
  const ownsCompiler = compilerOwner === null;
  let completed = false, active = true, work;
  try {
    work = mkdtempSync(join(tmpdir(), 'prismpm-session-'));
    function workspaceIdentity(path) {
      assert.equal(realpathSync(path),path,'unaliased session workspace');
      const stat=lstatSync(path,{bigint:true});
      assert.ok(stat.isDirectory()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o077n)===0n,'private owned session workspace');
      return Object.freeze(Object.fromEntries(['dev','ino','uid','gid','mode'].map(key=>[key,stat[key].toString()])));
    }
    const identity=workspaceIdentity(work),staged=new Map();
    function checkedWorkspace(path=work) {
      assert.deepEqual(workspaceIdentity(path),identity,'session workspace root identity');
    }
    function stage(path,bytes) {
      const destination=join(work,path);mkdirSync(dirname(destination),{recursive:true});
      writeFileSync(destination,bytes,{flag:'wx'});staged.set(destination,captureFile(destination).evidence);
    }
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      stage(join('project','src',...module.split('.'))+'.lex.tex',bytes);
    }
    const base = capturedInput('tests/fixtures/library/native-library/project/lexlean.toml',inputs).toString('utf8')
      .replace('name = "library-probe"', 'name = "session-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    stage('project/lexlean.toml',base);
    stage('project/lakefile.toml','name = "session_conformance"\nversion = "0.1.0"\n');
    stage('project/lean-toolchain',capturedInput('lean-toolchain',inputs));
    stage('rust-toolchain.toml',capturedInput('rust-toolchain.toml',inputs));
    run('lake', ['update'], project);
    const verified = freezeRecord(JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work)));
    assert.deepEqual(verified.modules, modules);
    const manifestBytes = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
    const readLean = root => new Map(modules.map(name=>[name,captureFile(join(root,'PrismPM',...name.split('.'))+'.lean').bytes]));
    const readOutputs = () => new Map(provenanceContract.outputRows.map(row=>[row.path,captureFile(join(verified.root,row.path)).bytes]));
    const provenance = provenanceContract.capture({verified,sources,manifestBytes,attestationBytes,
      generated:readLean(join(verified.root,'modules')),outputs:readOutputs()});
    const attestation = JSON.parse(attestationBytes);
    assert.equal(attestation.status, 'verified');
    assert.equal(attestation.build_manifest.sha256, sha(manifestBytes));
    assert.equal(attestation.attestation_id, verified.attestation_id);
    const expected = new Map([...sources].flatMap(([module, bytes]) => {
      const semantic = JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1]);
      return semantic.declarations.map(declaration => ['PrismPM.' + module + '.' + declaration.name,
        {kind: declaration.axioms?.length ? 'exact' : 'none', axioms: declaration.axioms ?? []}]);
    }));
    assert.equal(attestation.declarations.length, expected.size);
    for (const audit of attestation.declarations) {
      assert.equal(audit.result, 'ok'); assert.ok(expected.has(audit.name));
      const policy = expected.get(audit.name); assert.deepEqual(audit.policy, policy);
      assert.deepEqual(audit.observed, policy.axioms); expected.delete(audit.name);
    }
    assert.equal(expected.size, 0);
    const lean = join(work, 'lean'); mkdirSync(lean);
    for (const module of modules) {
      stage(join('lean','PrismPM',...module.split('.'))+'.lean',provenance.generatedBytes(module));
    }
    stage('lean/lean-toolchain',capturedInput('lean-toolchain',inputs));
    stage('lean/lakefile.toml','name = "session_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.Browser.Application.V1.SessionWire.sourceSessionWireBytes',
      'PrismPM.Fixture.fixtureSourceDispatchBytes', 'PrismPM.Fixture.fixtureSourceSizeBytes'].sort();
    compiler.runExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserSession', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const licenses=join(work,'licenses');mkdirSync(licenses);
    for(const path of ['LICENSE-MIT','LICENSE-APACHE'])stage('licenses/'+path,capturedInput(path,inputs));
    const generation = freezeRecord(JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work)));
    const packages = new Map([['native',captureGeneratedPackage(generated,{kind:'native',inputIrSha256:generation.ir_sha256})]]);
    const nativePrograms = new Map(), wasmArtifacts = new Map();
    const runner=work,observers=new Map();
    function registerObserver(name,artifact,kind) {
      assert.ok(active,'session build retired');checkedWorkspace();
      assert.match(name,/^[a-z][a-z0-9-]{0,95}$/,'closed session observer name');
      assert.ok(!observers.has(name),'unique session observer');
      assert.ok(['native','wasm'].includes(kind),'closed session observer kind');
      assert.ok(artifact.path.startsWith(work+'/'),'session observer belongs to actual build');
      (kind==='native'?requireCompilerArtifact:requireGeneratedWasm)(artifact);
      observers.set(name,Object.freeze({kind,artifact}));
      return artifact;
    }
    function compileNative(standard) {
      assert.equal(typeof standard,'boolean'); unchanged();
      if (nativePrograms.has(standard)) {nativePrograms.get(standard).verify(); return nativePrograms.get(standard).path;}
      const mode=standard?'std':'no_std', directory=join(work,'runner-'+mode);
      stage('runner-'+mode+'/src/main.rs',capturedInput('tests/browser-session/runner.rs',inputs));
      stage('runner-'+mode+'/Cargo.lock','version = 4\n[[package]]\nname = "browser-session-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-session-runner"\nversion = "0.1.0"\ndependencies = ["browser-session-core-probe"]\n');
      stage('runner-'+mode+'/Cargo.toml', '[package]\nname = "browser-session-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-session-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      const target = join(work,'native-target-'+(standard?'std':'no_std'));
      try {run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(directory, 'Cargo.toml')], directory, {CARGO_TARGET_DIR:target});}
      finally {unchanged();}
      const artifact = captureCompilerArtifact(work,join(target,'release/browser-session-runner'),'native-'+(standard?'std':'no-std'));
      nativePrograms.set(standard,artifact); artifact.verify(); return artifact.path;
    }
    function runNative(standard,args) {
      compileNative(standard);
      try {return nativePrograms.get(standard).run(args,runner);}
      finally {unchanged();}
    }
    function unchanged() {
      assert.ok(active,'session build retired');
      checkedWorkspace();
      requireCompilerOwner(compiler,'session');
      assertFrozenInputs(inputs);
      for(const value of packages.values())value.verify();
      for(const value of nativePrograms.values())value.verify();
      for(const value of wasmArtifacts.values())value.verify();
      for(const {artifact} of observers.values())artifact.verify();
      for(const [path,evidence] of staged)capturedFile(path,evidence);
      assert.equal(generation.ir_sha256,sha(readFileSync(ir)));
      assert.deepEqual(readFileSync(join(verified.root,'build-manifest.json')),manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root,'attestation.json')),attestationBytes);
      for(const [module,bytes] of sources)assert.deepEqual(readFileSync(join(project,'src',...module.split('.'))+'.lex.tex'),bytes);
      provenance.verify({verified,sources:new Map(modules.map(name=>[name,captureFile(join(project,'src',...name.split('.'))+'.lex.tex').bytes])),
        manifestBytes:readFileSync(join(verified.root,'build-manifest.json')),
        attestationBytes:readFileSync(join(verified.root,'attestation.json')),
        generated:readLean(join(verified.root,'modules')),staged:readLean(lean),outputs:readOutputs()});
    }
    const guests = [], fixtures = [], sizes = [];
    const modes=planted ? [[planted.fixture?'fixture-mutant':'mutant',planted.fixture?'fixture':'wasm']]
      : [['a', 'wasm'], ['b', 'wasm'], ['fixture-a', 'fixture'], ['fixture-b', 'fixture'], ['size-a', 'size'], ['size-b', 'size']];
    for (const [label, mode] of modes) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(compiler.runDriver([mode, ir, guest, licenses], work)), generation);
      const package_ = captureGeneratedPackage(guest,{kind:'wasm',inputIrSha256:generation.ir_sha256});
      packages.set(label,package_);
      const target = join(work,'guest-target-'+label);
      try {run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR:target});}
      finally {package_.verify();}
      const artifact = captureGeneratedWasm(work,join(target,'wasm32-unknown-unknown/release/browser_session_' + (mode === 'wasm' ? 'wire' : mode) + '_probe.wasm'),'guest-'+label+'-execution');
      wasmArtifacts.set(label,artifact);
      (mode === 'fixture' ? fixtures : mode === 'size' ? sizes : guests).push(artifact.bytes);
    }
    if(!planted) {
      assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
      assert.deepEqual(fixtures[0], fixtures[1], 'two independent generated source wrapper packages');
      assert.deepEqual(sizes[0], sizes[1], 'two independent generated real writer-size parity packages');
    }
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'unchanged source after actual compiler execution ' + module);
    for (const [module, bytes] of sources) assert.deepEqual(readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex'), bytes, 'unchanged staged source after actual compiler execution ' + module);
    for(const path of ['LICENSE-MIT','LICENSE-APACHE'])assert.equal(sha(readFileSync(join(licenses,path))),inputs[path],'unchanged staged license');
    unchanged();
    completed = true;
    const fixed = {work, sources:new Map([...sources].map(([name,bytes])=>[name,Buffer.from(bytes)])), verified, generation, compileNative, runNative, unchanged, runner,registerObserver,
      wasmBytes:guests[0],fixtureBytes:fixtures[0],sizeBytes:sizes[0],mutation:planted,
      compilerOwner:compiler,compiler:compiler.identity,
      provenance:provenance.evidence,
      generatedPackages:Object.freeze(Object.fromEntries([...packages].map(([name,value])=>[name,value.files]))),
      wasmArtifacts:Object.freeze(Object.fromEntries(wasmArtifacts)),
      nativeEvidence:()=>Object.freeze(Object.fromEntries([...nativePrograms].map(([standard,value])=>[standard?'std':'no_std',value.evidence]))),
      observerEvidence() {
        unchanged();
        return freezeRecord(Object.fromEntries([...observers].map(([name,{kind,artifact}])=>[name,{kind,evidence:artifact.evidence}])));
      },
      close(retireCompiler=false) {
        assert.equal(typeof retireCompiler,'boolean');
        unchanged();
        assert.equal(dirname(work),tmpdir(),'owned session workspace parent');
        assert.match(work.slice(tmpdir().length+1),/^prismpm-session-[A-Za-z0-9]+$/,'exact owned session workspace');
        // Compiler retirement must succeed before primary diagnostics disappear.
        const compilerRetirement=ownsCompiler||retireCompiler?compiler.close():undefined;
        checkedWorkspace();
        const retirement=mkdtempSync(join(tmpdir(),'prismpm-session-retirement-'));
        const removed=join(retirement,'completed');
        try {
          renameSync(work,removed);checkedWorkspace(removed);
          rmSync(removed,{recursive:true});rmdirSync(retirement);
        }catch(error){process.stderr.write('Retained session retirement diagnostic '+retirement+'\n');throw error;}
        assert.equal(lstatSync(removed,{throwIfNoEntry:false}),undefined,'completed session workspace removed');
        active=false;
        return freezeRecord({status:'removed',scope:'completed-private-session-build',identity,
          ...(compilerRetirement===undefined?{}:{compilerRetirement})});
      }};
    return Object.defineProperties({},Object.fromEntries(Object.entries(fixed).map(([name,value])=>
      [name,{value,enumerable:true,writable:false,configurable:false}])));
  } finally {
    if (!completed) {
      if(ownsCompiler)compiler.close();
      process.stderr.write('Retained incomplete session diagnostic build ' + (work??'not allocated') + '\n');
    }
  }
}
