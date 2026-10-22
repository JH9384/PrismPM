import assert from 'node:assert/strict';
import {chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {frozenInputs, repository, requirePreparedComponent, run, sha, verifyFrozenInputs} from './compile.mjs';

function substitutePrivateInputs(initialInputs) {
  let inputs = initialInputs;
  assert.equal(dirname(repository), realpathSync(tmpdir()), 'private input-copy parent');
  assert.match(basename(repository), /^prismpm-primary-input-checks-[A-Za-z0-9]+$/);
  assert.equal(realpathSync(repository), resolve(repository));
  const directory = lstatSync(repository);
  assert.ok(directory.isDirectory() && directory.uid === process.getuid()
    && (directory.mode & 0o777) === 0o700, 'owned private input-copy directory');
  verifyFrozenInputs(inputs);
  const relativePath = 'tests/browser-effects/corpus.mjs';
  assert.ok(Object.hasOwn(inputs, relativePath), 'actual transitive Session corpus dependency');
  const path = join(repository, relativePath), bytes = readFileSync(path);
  assert.equal(sha(bytes), inputs[relativePath]);
  const omitted = {...inputs}; delete omitted[relativePath];
  assert.throws(() => verifyFrozenInputs(omitted), /actual complete captured input inventory/);
  const held = path + '.ho15-input-held'; assert.equal(existsSync(held), false);
  renameSync(path, held);
  try {assert.throws(() => verifyFrozenInputs(inputs), /ENOENT/);}
  finally {renameSync(held, path);}
  // Restored bytes are not restoration of the old captured inode/timestamps.
  // Capture a fresh test-only graph after each mutation; never revive a token.
  inputs = frozenInputs(); assert.deepEqual(inputs, initialInputs); verifyFrozenInputs(inputs);
  const changed = Buffer.concat([bytes, Buffer.from('\n// planted transitive input change\n')]);
  try {
    writeFileSync(path, changed);
    assert.throws(() => verifyFrozenInputs(inputs), /immutable captured file custody/);
    assert.throws(() => verifyFrozenInputs({...inputs, [relativePath]: sha(changed)}),
      /actual complete captured input inventory/);
  } finally {writeFileSync(path, bytes);}
  assert.throws(() => verifyFrozenInputs(inputs), /immutable captured file custody/);
  inputs = frozenInputs(); assert.deepEqual(inputs, initialInputs); verifyFrozenInputs(inputs);
  linkSync(path, held);
  try {assert.throws(() => verifyFrozenInputs(inputs), /bounded single-link custody file/);}
  finally {unlinkSync(held);}
  assert.throws(() => verifyFrozenInputs(inputs), /immutable captured file custody/);
  inputs = frozenInputs(); assert.deepEqual(inputs, initialInputs); verifyFrozenInputs(inputs);
  return ['omitted-transitive-map', 'missing-transitive-file', 'changed-transitive-file',
    'forged-matching-transitive-map', 'hard-linked-transitive-file'];
}

export function inputClosureAdversaries(inputs) {
  verifyFrozenInputs(inputs);
  // Deliberate substitutions must never write the repository or installed SDK.
  // The copied harness independently captures and brands its complete graph.
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'prismpm-primary-input-checks-'));
  for (const [path, digest] of Object.entries(inputs)) {
    assert.ok(path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part)
      && part !== '.' && part !== '..'), 'closed captured input path');
    const bytes = readFileSync(join(repository, path));
    assert.equal(sha(bytes), digest, 'exact captured input copy');
    const target = join(work, path); mkdirSync(dirname(target), {recursive:true});
    writeFileSync(target, bytes, {flag:'wx'});
  }
  let result;
  try {
    result = JSON.parse(run(process.execPath,
      [join(work, 'tests/holo-primary-component/adversaries.mjs'), '--private-input-checks'], work));
    assert.deepEqual(result.inputs, inputs, 'complete independently captured private input closure');
    assert.deepEqual(result.cases, ['omitted-transitive-map', 'missing-transitive-file', 'changed-transitive-file',
      'forged-matching-transitive-map', 'hard-linked-transitive-file']);
    for (const [path, digest] of Object.entries(inputs))
      assert.equal(sha(readFileSync(join(work, path))), digest, 'private input restored after actual defect');
  } finally {verifyFrozenInputs(inputs);}
  return {work, ...result};
}

function ownedFile(owner, path) {
  assert.ok(relative(owner.work, path) && !relative(owner.work, path).startsWith('..'));
  assert.equal(realpathSync(path), path);
  const stat = lstatSync(path); assert.ok(stat.isFile() && stat.uid === process.getuid()); return stat;
}
function substitute(owner, path, replacement, check) {
  const stat = ownedFile(owner, path), bytes = readFileSync(path);
  try {
    chmodSync(path, (stat.mode & 0o777) | 0o200); writeFileSync(path, replacement);
    chmodSync(path, stat.mode & 0o777);
    return check();
  }
  finally {
    chmodSync(path, (stat.mode & 0o777) | 0o200);
    try {writeFileSync(path, bytes);} finally {chmodSync(path, stat.mode & 0o777);}
  }
}
const poisoned = bytes => Buffer.concat([bytes, Buffer.from('\nsource substitution\n')]);
// A coherent forgery must pass the producer's canonical encoding/digest checks
// before the original captured-package identity rejects it.
export function matchingPackageManifest(bytes, path, replacement) {
  const manifest = JSON.parse(bytes);
  const rows = manifest.files.filter(row => row.path === path);
  assert.equal(rows.length, 1, 'one declared substitution target');
  rows[0].sha256 = sha(replacement);
  return Buffer.from(JSON.stringify(manifest, (_key, value) =>
    value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) + '\n');
}
function missing(owner, path, check) {
  ownedFile(owner, path); const held = path + '.missing-held';
  assert.equal(existsSync(held), false); renameSync(path, held);
  try {return check();} finally {renameSync(held, path);}
}

export function artifactAdversaries(owner) {
  const receipts = [], passed = name => receipts.push(name);
  assert.throws(() => requirePreparedComponent({...owner}), /actual fresh owning compiler/); passed('forged-owner-object');
  assert.throws(() => requirePreparedComponent({inputs:owner.inputs,wasm:owner.wasm}), /actual fresh owning compiler/); passed('self-supplied-receipt');
  const generated = join(owner.work, 'generated/src/lib.rs');
  const manifest = join(owner.work, 'generated/generation-manifest.json');
  const original = readFileSync(generated);
  for (const standard of [true, false]) {
    const runner = join(owner.work, 'runner-' + (standard ? 'std' : 'no-std'));
    substitute(owner, generated, poisoned(original), () => {
      assert.throws(() => owner.compileNative(standard), /generated package/);
      assert.equal(existsSync(runner), false, 'refusal precedes first Cargo invocation');
    }); passed('first-native-' + standard + '-source-substitution');
    substitute(owner, generated, poisoned(original), () => {
      const declaration = matchingPackageManifest(readFileSync(manifest), 'src/lib.rs', poisoned(original));
      substitute(owner, manifest, declaration, () => {
        assert.throws(() => owner.compileNative(standard), /immutable generated package/);
        assert.equal(existsSync(runner), false);
      });
    }); passed('first-native-' + standard + '-forged-matching-package-manifest');
    missing(owner, manifest, () => {
      assert.throws(() => owner.compileNative(standard), /ENOENT/);
      assert.equal(existsSync(runner), false);
    }); passed('first-native-' + standard + '-missing-package-manifest');
  }
  for (const [name, path] of [
    ['captured-source', join(owner.work, 'project/src/Foundation/Holo/V1/PrimaryWire.lex.tex')],
    ['kernel-attestation', join(owner.verified.root, 'attestation.json')],
    ['verified-build-manifest', join(owner.verified.root, 'build-manifest.json')],
    ['exported-ir', join(owner.work, 'export/kernel.ir')],
  ]) {
    const bytes = readFileSync(path);
    substitute(owner, path, poisoned(bytes), () => assert.throws(() => requirePreparedComponent(owner), /AssertionError/));
    owner.unchanged(); passed(name + '-substitution');
    if (name === 'captured-source' || name === 'kernel-attestation') {
      missing(owner, path, () => assert.throws(() => requirePreparedComponent(owner), /ENOENT/));
      owner.unchanged(); passed(name + '-missing');
    }
  }
  for (const standard of [true, false]) {
    const path = owner.compileNative(standard), bytes = readFileSync(path);
    const sentinel = join(owner.work, 'must-not-execute-' + standard);
    substitute(owner, path, poisoned(bytes), () => {
      assert.throws(() => owner.runNative(standard, ['capabilities', sentinel]), /immutable private compiler/);
      assert.equal(existsSync(sentinel), false);
    }); passed('native-' + standard + '-substitution');
    missing(owner, path, () => {
      assert.throws(() => owner.runNative(standard, ['capabilities', sentinel]), /ENOENT/);
      assert.equal(existsSync(sentinel), false);
    }); passed('native-' + standard + '-missing');
  }
  for (const [at, wasm] of owner.wasm.session.entries()) {
    const originalPath = join(owner.work, wasm.evidence.original.path);
    for (const [name, path] of [['original', originalPath], ['private', wasm.path]]) {
      const replacement = Buffer.concat([readFileSync(path), Buffer.from([0, 2, 1, 97])]);
      assert.ok(WebAssembly.validate(replacement), 'planted replacement remains a valid Wasm module');
      let invoked = false;
      substitute(owner, path, replacement, () => {
        assert.throws(() => wasm.run(() => {invoked = true;}), /immutable .*generated Wasm/);
        assert.equal(invoked, false);
      }); passed('wasm-' + at + '-' + name + '-valid-module-substitution');
      missing(owner, path, () => assert.throws(() => wasm.run(() => assert.fail('missing Wasm executed')), /ENOENT/));
      passed('wasm-' + at + '-' + name + '-missing');
    }
    const saved = Buffer.from(wasm.bytes); wasm.bytes[7] ^= 1;
    try {assert.throws(() => wasm.run(() => assert.fail('mutated in-memory artifact executed')), /immutable execution Wasm buffer/);}
    finally {wasm.bytes.set(saved);}
    passed('wasm-' + at + '-in-memory-substitution');
    const stat = ownedFile(owner, originalPath), held = originalPath + '.original-held';
    const bytes = readFileSync(originalPath), extra = originalPath + '.planted-link';
    assert.equal(stat.nlink, 2, 'actual Cargo original has exactly two links in this fixture');
    renameSync(originalPath, held);
    try {
      writeFileSync(originalPath, bytes, {flag:'wx',mode:stat.mode & 0o777}); linkSync(originalPath, extra);
      assert.equal(lstatSync(originalPath).nlink, stat.nlink);
      assert.equal(sha(readFileSync(originalPath)), wasm.evidence.original.sha256);
      assert.throws(() => wasm.run(() => assert.fail('replaced original inode executed')), /immutable original generated Wasm/);
    } finally {if (existsSync(extra)) unlinkSync(extra); if (existsSync(originalPath)) unlinkSync(originalPath); renameSync(held, originalPath);}
    wasm.verify(); passed('wasm-' + at + '-same-bytes-and-link-count-inode-substitution');
  }
  owner.unchanged(); assert.equal(receipts.length, 30); return receipts;
}

export function componentAdversaries(component, owner, attempt) {
  const receipts = [];
  for (const [name, path] of Object.entries(component.paths)) {
    substitute(owner, path, poisoned(readFileSync(path)), () => {
      assert.throws(() => attempt(component), /exact captured component input|admitted component artifact/);
      assert.equal(existsSync(join(owner.work, 'must-not-enter-runtime')), false, 'artifact refusal precedes either executor');
    }); component.verify(); receipts.push('component-' + name + '-substitution');
  }
  assert.throws(() => attempt({...component}), /actual source-composed component/);
  receipts.push('forged-component-receipt');
  assert.equal(receipts.length, 6); return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--private-input-checks']);
  const inputs = frozenInputs(), cases = substitutePrivateInputs(inputs);
  process.stdout.write(JSON.stringify({inputs, cases}));
}
