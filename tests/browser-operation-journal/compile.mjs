import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {createPrivateDriverTarget, ensureProdExport, run, sha} from '../browser-view/compile.mjs';
export {ensureProdExport, run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture', 'Foundation.Browser.Application.V1.OperationJournal',
  'Foundation.Browser.Application.V1.OperationJournalWire', 'Foundation.Browser.Application.V1.Effects',
  'Foundation.Browser.Application.V1.EffectsWire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive'].sort();

function pins() {
  const artifacts = readFileSync(join(repository, 'model/dependencies.toml'), 'utf8')
    .split('[[dependency.artifact]]').slice(1).map(section => {
      const text = section.split('[[dependency]]')[0];
      return {path: /^path = "([^"]+)"$/m.exec(text)?.[1],
        hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],
        tree: /^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
    });
  for (const name of ['vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256']) {
    const rows = artifacts.filter(row => row.path === name); assert.equal(rows.length, 1);
    const [{hash, tree}] = rows, bytes = readFileSync(join(repository, name));
    assert.equal(sha(bytes), hash, name);
    if (!tree) continue;
    const seen = new Set();
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      const [, digest, path] = row;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(path)); seen.add(path);
      assert.equal(sha(readFileSync(join(repository, tree, path))), digest, path);
    }
  }
}

function stageCompiler(work) {
  // Cargo resolves inherited workspace lint/dependency policy while loading
  // path dependencies. Keep each pinned vendor workspace intact, outside any
  // containing checkout/worktree workspace; do not override its policy.
  const captured = [];
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const entries = readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n');
    for (const entry of entries) {
      const [, digest, relative] = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(entry);
      const source = join(repository, tree, relative), destination = join(work, tree, relative);
      const bytes = readFileSync(source); assert.equal(sha(bytes), digest);
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
      captured.push({source, destination, digest});
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/browser-operation-journal/driver', relative);
    const bytes = readFileSync(source), digest = sha(bytes);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/browser-operation-journal/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export function prepare(mutation = null, sourceOnly = false) {
  assert.ok([null, 'binding', 'trailing', 'reservation', 'payload', 'partition'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!/^PRISMPM_(?:EFFECT|JOURNAL)_/.test(key), 'effects acceptance refuses bypass ' + key);
  pins();
  const work = mkdtempSync(join(tmpdir(), 'prismpm-operation-journal-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  let completed = false;
  try {
    if (mutation) {
      const module = mutation === 'trailing' ? 'Foundation.Browser.Application.V1.OperationJournalWire' : 'Foundation.Browser.Application.V1.OperationJournal';
      const text = sources.get(module).toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text);
      const model = JSON.parse(matched[1]); let changed = 0;
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (mutation === 'binding' && node.kind === 'call' && node.function.name === 'journalRecordRequestEqual') {
          node.arguments[1] = structuredClone(node.arguments[0]); changed++; return;
        }
        if (mutation === 'trailing' && node.kind === 'beq' && node.right?.kind === 'primitive' && node.right.operation === 'length') {
          const original = structuredClone(node); Object.keys(node).forEach(key => delete node[key]);
          Object.assign(node, {kind:'or', left:original, right:{kind:'bool', value:true}}); changed++; return;
        }
        if (mutation === 'reservation' && node.kind === 'add' && node.right?.kind === 'nat' && node.right.value === '2') {
          node.right.value = '1'; changed++; return;
        }
        if (mutation === 'payload' && node.kind === 'beq' && node.left?.kind === 'var' && node.left.name === 'remaining') {
          const original = structuredClone(node); Object.keys(node).forEach(key => delete node[key]);
          Object.assign(node, {kind:'or', left:original, right:{kind:'bool',value:true}}); changed++; return;
        }
        if (mutation === 'partition' && node.kind === 'nat' && node.value === '1048576') {
          node.value = '1048575'; changed++; return;
        }
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
      }
      const selected = mutation === 'trailing' ? 'dispatchJournalWire' : mutation === 'payload' ? 'journalChunksValid'
        : mutation === 'partition' ? 'operationChunkPlan' : 'appendOperationRecord';
      const declarations = model.declarations.filter(row => row.name === selected);
      assert.equal(declarations.length, 1); declarations.forEach(walk);
      assert.equal(changed, mutation === 'trailing' ? 7 : mutation === 'partition' ? 4 : 1, 'exact production guard mutation');
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      sources.set(module, Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}')));
    }
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = readFileSync(join(repository, 'tests/fixtures/library/native-library/project/lexlean.toml'), 'utf8')
      .replace('name = "library-probe"', 'name = "operation-journal-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "operation_journal_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    copyFileSync(join(repository, 'lean-toolchain'), join(project, 'lean-toolchain'));
    copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
    const driverTarget = createPrivateDriverTarget(work);
    const compiler = stageCompiler(work);
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
    const driver = join(driverTarget, 'debug/browser-operation-journal-driver');
    if (sourceOnly) { const checked = JSON.parse(run(driver, ['check', join(project, 'lexlean.toml')], repository)); assert.deepEqual(checked.modules, modules); completed = true; return {work, checked}; }
    run('lake', ['update'], project);
    const verified = JSON.parse(run(driver, ['verify', join(project, 'lexlean.toml')], repository));
    assert.deepEqual(verified.modules, modules);
    const manifestBytes = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
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
      const relative = join('PrismPM', ...module.split('.')) + '.lean', destination = join(lean, relative);
      mkdirSync(dirname(destination), {recursive: true}); copyFileSync(join(verified.root, 'modules', relative), destination);
    }
    copyFileSync(join(repository, 'lean-toolchain'), join(lean, 'lean-toolchain'));
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "operation_journal_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.Browser.Application.V1.OperationJournalWire.journalWireBytes', 'PrismPM.Foundation.Browser.Application.V1.OperationJournalWire.journalPartitionBytes', 'PrismPM.Foundation.Browser.Application.V1.EffectsWire.effectWireBytes', 'PrismPM.Fixture.fixtureEchoBytes'].sort();
    run(prodExport, ['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserOperationJournal', '--out', exported], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(run(driver, ['native', ir, generated, repository], repository));
    const generatedAgain = join(work, 'generated-b');
    assert.deepEqual(JSON.parse(run(driver, ['native', ir, generatedAgain, repository], repository)), generation);
    const tree = directory => readdirSync(directory, {recursive: true, withFileTypes: true})
      .filter(entry => entry.isFile()).map(entry => {
        const absolute = join(entry.parentPath, entry.name);
        return [absolute.slice(directory.length + 1), sha(readFileSync(absolute))];
      }).sort(([left], [right]) => left.localeCompare(right));
    assert.deepEqual(tree(generated), tree(generatedAgain), 'complete independent generated native artifact closures');
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    copyFileSync(join(draft, 'runner.rs'), join(runner, 'src/main.rs'));
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-operation-journal-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-operation-journal-runner"\nversion = "0.1.0"\ndependencies = ["browser-operation-journal-core-probe"]\n', {flag: 'wx'});
    function compileNative(standard) {
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-operation-journal-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-operation-journal-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: join(work, 'native-target')});
      return join(work, 'native-target/release/browser-operation-journal-runner');
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm'], ['echo', 'guest'], ['journal', 'journal'], ['partition', 'partition'],
      ['journal-b', 'journal'], ['partition-b', 'partition']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(run(driver, [mode, ir, guest, repository], repository)), generation);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/browser_operation_journal_' + (mode === 'guest' ? 'guest' : mode === 'wasm' ? 'wire' : mode) + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    assert.deepEqual(guests[3], guests[5], 'two independent generated journal packages');
    assert.deepEqual(guests[4], guests[6], 'two independent generated partition packages');
    pins(); compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, wasmBytes: guests[0], guestBytes: guests[2], journalBytes: guests[3], partitionBytes: guests[4]};
  } finally { if (!completed) process.stderr.write('Retained incomplete operation-journal diagnostic build ' + work + '\n'); }
}
