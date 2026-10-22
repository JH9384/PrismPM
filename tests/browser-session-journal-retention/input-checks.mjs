// Actual changes to a captured transitive input, never a substituted reader.
import assert from 'node:assert/strict';
import {existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {frozenInputs, repository, run, sha, verifyFrozenInputs} from './compile.mjs';

function substitutePrivateInputs(inputs) {
  assert.equal(dirname(repository), realpathSync(tmpdir()), 'private input-copy parent');
  assert.match(basename(repository), /^prismpm-retention-input-checks-[A-Za-z0-9]+$/, 'private input-copy directory name');
  assert.equal(realpathSync(repository), resolve(repository));
  const directory = lstatSync(repository);
  assert.ok(directory.isDirectory() && directory.uid === process.getuid()
    && (directory.mode & 0o777) === 0o700, 'owned private input-copy directory');
  verifyFrozenInputs(inputs);
  const relative = 'tests/browser-effects/corpus.mjs';
  assert.ok(Object.hasOwn(inputs, relative), 'actual transitive Session corpus is captured');
  const path = join(repository, relative), bytes = readFileSync(path), held = path + '.retention-input-held';
  assert.equal(sha(bytes), inputs[relative]); assert.equal(existsSync(held), false);
  const omitted = {...inputs}; delete omitted[relative];
  assert.throws(() => verifyFrozenInputs(omitted), /actual complete captured retention inputs/);
  renameSync(path, held);
  try {assert.throws(() => verifyFrozenInputs(inputs), /ENOENT/);}
  finally {renameSync(held, path);}
  verifyFrozenInputs(inputs);
  const changed = Buffer.concat([bytes, Buffer.from('\n// actual changed transitive input\n')]);
  try {
    writeFileSync(path, changed);
    assert.throws(() => verifyFrozenInputs(inputs), /immutable captured retention input/);
    assert.throws(() => verifyFrozenInputs({...inputs, [relative]: sha(changed)}),
      /actual complete captured retention inputs/);
  } finally {writeFileSync(path, bytes);}
  verifyFrozenInputs(inputs);
  linkSync(path, held);
  try {assert.throws(() => verifyFrozenInputs(inputs), /regular singly linked compiler input/);}
  finally {unlinkSync(held);}
  verifyFrozenInputs(inputs);
  return ['omitted-map', 'missing-file', 'changed-file', 'forged-matching-map', 'hard-linked-file'];
}

export function verifyRetentionInputSubstitutions(inputs) {
  verifyFrozenInputs(inputs);
  // Never mutate the repository or installed SDK: other owners may read the
  // same transitive source, and the immutable SDK can be mounted read-only.
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'prismpm-retention-input-checks-'));
  for (const [relative, digest] of Object.entries(inputs)) {
    assert.ok(relative.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part)
      && part !== '.' && part !== '..'), 'closed captured input path');
    const bytes = readFileSync(join(repository, relative));
    assert.equal(sha(bytes), digest, 'actual captured input copied');
    const target = join(work, relative); mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, bytes, {flag: 'wx'});
  }
  let result;
  try {
    result = JSON.parse(run(process.execPath,
      [join(work, 'tests/browser-session-journal-retention/input-checks.mjs'), '--private-input-checks'], work));
    assert.deepEqual(result.inputs, inputs, 'complete independently captured copied closure');
    assert.deepEqual(result.cases, ['omitted-map', 'missing-file', 'changed-file', 'forged-matching-map', 'hard-linked-file']);
    for (const [relative, digest] of Object.entries(inputs))
      assert.equal(sha(readFileSync(join(work, relative))), digest, 'private inputs restored after actual defects');
  } finally {verifyFrozenInputs(inputs);}
  return {work, ...result};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--private-input-checks']);
  const inputs = frozenInputs();
  const cases = substitutePrivateInputs(inputs);
  process.stdout.write(JSON.stringify({inputs, cases}));
}
