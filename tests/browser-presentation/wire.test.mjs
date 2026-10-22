import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodePresentation, decodeIntent, encodeWire, encodeIntent, validateIntent,
  presentationRequiresSecret, intentRequiresSecret} from '../../sdk/browser/presentation-wire.mjs';
import {corpus, boundaries, basic} from './corpus.mjs';
import {chmodSync, copyFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ownFixtureFiles, consumeNativeFixtures} from './fixture-files.mjs';

test('independent strict host parser accepts complete positive corpus and rejects all negative mutations', () => {
  for (const row of [...corpus(), ...boundaries()]) {
    const decode = row.request[0] === 0x84 ? decodeIntent : decodePresentation;
    if (row.request === row.response) assert.deepEqual(encodeWire(decode(row.request)), row.request, row.id);
    else assert.throws(() => decode(row.request), undefined, row.id);
  }
});
test('exact modeled intent bindings, revision, required values, choice and byte limits', () => {
  const frame = basic(), good = [1, 1, 1, [[5, 'a'], [6, 'b'], [7, 1]]];
  assert.equal(validateIntent(frame, good), true);
  for (const mutate of [x => {x[1]++;}, x => {x[2]++;}, x => {x[3].pop();},
    x => {x[3][0][1] = '';}, x => {x[3][0][1] = 'x'.repeat(33);},
    x => {x[3][2][1] = 0;}, x => {x[3][2][1] = 2;}, x => {x[3][0][1] = 1;}]) {
    const bad = structuredClone(good); mutate(bad); assert.throws(() => validateIntent(frame, bad));
  }
  const bytes = encodeIntent(good); assert.deepEqual(encodeIntent(good, bytes.length), bytes);
  assert.throws(() => encodeIntent(good, bytes.length - 1));
});
test('unpaired UTF-16, native byte brands, detached and shared buffers reject', () => {
  assert.throws(() => encodeIntent([1, 0, 1, [[1, '\ud800']]]));
  assert.throws(() => decodePresentation({byteLength: 8, buffer: new ArrayBuffer(8)}));
  assert.throws(() => decodePresentation(new Uint8Array(new SharedArrayBuffer(8))));
  const detached = new Uint8Array(8); structuredClone(detached, {transfer: [detached.buffer]});
  assert.throws(() => decodePresentation(detached));
});
test('declared per-View cap accepts exact bytes and rejects one-over without a fallback', () => {
  const bytes = encodeWire(basic());
  assert.deepEqual(decodePresentation(bytes, bytes.length), basic());
  assert.throws(() => decodePresentation(bytes, bytes.length - 1));
  assert.throws(() => decodePresentation(bytes, 0));
  assert.throws(() => decodePresentation(bytes, 67108865));
  const bomb = boundaries().find(row => row.id === 'AggregateFuelOver');
  assert.ok(bomb.request.length < 67108864);
  assert.throws(() => decodePresentation(bomb.request), error => error.code === 'limit');
});

test('closed secret input has no default and preserves exact action, epoch and UTF-8 bounds', () => {
  const frame = [1, 1, 0, 0, 0, 0, [
    [0, [2, 0]], [1, [10, 1, true, true, 4, 4294967295]],
    [1, [8, 2, 1, true, true, [2]]],
  ]];
  assert.deepEqual(decodePresentation(encodeWire(frame)), frame);
  assert.equal(validateIntent(frame, [1, 1, 1, [[2, '😀']]]), true);
  assert.equal(presentationRequiresSecret(frame), true);
  assert.equal(intentRequiresSecret(frame, [1, 1, 1, [[2, '😀']]]), true);
  const ordinary = structuredClone(frame); ordinary[6].push([1, [8, 2, 2, true, false, []]]);
  assert.equal(intentRequiresSecret(ordinary, [1, 1, 2, []]), false);
  assert.equal(presentationRequiresSecret(basic()), false);
  for (const value of ['', '😀x', 1, '\ud800']) {
    assert.throws(() => validateIntent(frame, [1, 1, 1, [[2, value]]]));
  }
  for (const mutate of [
    x => { x[6][1][1].splice(5, 0, 'forbidden default'); },
    x => { x[6][1][1][4] = 0; },
    x => { x[6][1][1][4] = 67108865; },
    x => { x[6][1][1][5] = 4294967296; },
    x => { x[6][1][0] = 0; },
    x => { x[6][1][1][2] = false; },
    x => { x[2] = 1; },
  ]) {
    const invalid = structuredClone(frame); mutate(invalid);
    assert.throws(() => decodePresentation(encodeWire(invalid)));
  }
  const maximum = structuredClone(frame); maximum[6][1][1][4] = 67108864;
  assert.deepEqual(decodePresentation(encodeWire(maximum)), maximum);
  const optional = structuredClone(frame); optional[6][1][1][3] = false;
  assert.equal(validateIntent(optional, [1, 1, 1, [[2, '']]]), true);
});

test('actual fixture files retain original custody and cannot skip or reseal retirement', () => {
  // Small infrastructure fixtures only; the owning gate still runs every real
  // maximum through both generated native implementations and Core-Wasm.
  const work = mkdtempSync(join(tmpdir(), 'presentation-fixture-custody-'));
  const bytes = Uint8Array.of(1, 2, 3);
  try {
    for (const mutation of ['none', 'bytes', 'inode', 'link', 'symlink', 'missing', 'parent', 'permissions']) {
      const root = join(work, mutation); mkdirSync(root, {mode: 0o700});
      const owner = ownFixtureFiles(root), first = owner.write('First.request', bytes);
      const second = owner.write('Second.response', bytes);
      assert.throws(() => owner.write('First.request', bytes), /exclusive bounded fixture inventory/);
      assert.throws(() => owner.write('../Outside.request', bytes));
      assert.throws(() => owner.assertRetired(), /retirement required/);
      assert.throws(() => owner.retire(), /sealed unretired/);
      owner.seal(); owner.verify();
      assert.throws(() => owner.seal());
      assert.throws(() => owner.write('Late.request', bytes), /creation closed/);
      if (mutation === 'none') {
        assert.throws(() => owner.assertRetired(), /retirement required/);
        const evidence = owner.retire();
        assert.equal(evidence.state, 'retired'); assert.equal(evidence.files.length, 2);
        assert.equal(evidence.bytes, 6); owner.assertRetired();
        for (const path of [first, second]) assert.equal(lstatSync(path, {throwIfNoEntry: false}), undefined);
        assert.throws(() => {evidence.files[0].sha256 = 'replaced';}, TypeError);
        assert.throws(() => owner.retire(), /sealed unretired/);
        writeFileSync(first, bytes, {flag: 'wx'});
        assert.throws(() => owner.assertRetired(), /reappeared/);
        continue;
      }
      if (mutation === 'bytes') writeFileSync(second, Uint8Array.of(1, 2, 4));
      if (mutation === 'inode') {
        renameSync(second, second + '.original'); copyFileSync(second + '.original', second);
      }
      if (mutation === 'link') linkSync(second, second + '.alias');
      if (mutation === 'symlink') {unlinkSync(second); symlinkSync(first, second);}
      if (mutation === 'missing') unlinkSync(second);
      if (mutation === 'parent') {
        renameSync(root, root + '.original'); mkdirSync(root, {mode: 0o700});
        writeFileSync(first, bytes, {flag: 'wx'}); writeFileSync(second, bytes, {flag: 'wx'});
      }
      if (mutation === 'permissions') chmodSync(root, 0o500);
      assert.throws(() => owner.verify(), undefined, mutation + ' original capture refuses');
      assert.throws(() => owner.retire(), undefined, mutation + ' cannot refresh or retire foreign files');
      assert.deepEqual(readFileSync(first), Buffer.from(bytes), 'verify every file before removing any');
      assert.throws(() => owner.assertRetired(), /retirement required/);
      if (mutation === 'permissions') chmodSync(root, 0o700);
    }
  } finally {rmSync(work, {recursive: true, force: true});}
});

test('production fixture orchestration refuses omitted/early retirement and retains failed consumers', async () => {
  const source = readFileSync(new URL('./fixture-files.mjs', import.meta.url), 'utf8');
  const original = 'const retirement = fixtures.retire();';
  assert.equal(source.split(original).length, 2);
  const work = mkdtempSync(join(tmpdir(), 'presentation-fixture-transition-'));
  try {
    for (const mutation of ['none', 'omit', 'early', 'std-failure', 'no-std-failure', 'unlink-error', 'creation-inode']) {
      let changed = source;
      if (mutation === 'omit') changed = source.replace(original, 'const retirement = undefined;');
      if (mutation === 'early') changed = source.replace(original, '').replace('const completed = [];', original + '\n  const completed = [];');
      if (mutation === 'unlink-error') {
        const anchor = 'checkParent(); unlinkSync(path); checkParent();'; assert.equal(source.split(anchor).length, 2);
        changed = source.replace(anchor, "checkParent(); unlinkSync(name === 'Second.response' ? path + '.absent' : path); checkParent();");
      }
      if (mutation === 'creation-inode') {
        const anchor = 'const captured = capture(path, fd);'; assert.equal(source.split(anchor).length, 2);
        changed = source.replace(anchor, "const fs = process.getBuiltinModule('fs'); fs.renameSync(path, path + '.created'); fs.copyFileSync(path + '.created', path); " + anchor);
      }
      // Execute the production module with one precise source fault, rather
      // than replacing its owner or inventing a passing retirement receipt.
      const module = mutation === 'none' ? {ownFixtureFiles, consumeNativeFixtures}
        : await import('data:text/javascript;base64,' + Buffer.from(changed).toString('base64'));
      const root = join(work, mutation); mkdirSync(root, {mode: 0o700});
      const owner = module.ownFixtureFiles(root);
      if (mutation === 'creation-inode') {
        assert.throws(() => owner.write('First.request', Uint8Array.of(1)), /stable fixture descriptor and name/);
        assert.equal(readFileSync(join(root, 'First.request.created'))[0], 1);
        continue;
      }
      const first = owner.write('First.request', Uint8Array.of(1));
      const second = owner.write('Second.response', Uint8Array.of(2));
      const consumed = [];
      const execute = () => module.consumeNativeFixtures(owner, standard => {
        assert.equal(readFileSync(first)[0], 1); assert.equal(readFileSync(second)[0], 2);
        consumed.push(standard);
        if (mutation === (standard ? 'std-failure' : 'no-std-failure')) throw Error('actual consumer failure');
      });
      if (mutation === 'none') {
        const receipt = await execute(); assert.equal(receipt.files.length, 2);
        assert.deepEqual(consumed, [true, false]); owner.assertRetired();
      } else {
        await assert.rejects(execute, mutation === 'omit' ? /retirement required/ : mutation === 'early' ? /sealed unretired/ : mutation === 'unlink-error' ? /ENOENT/ : /actual consumer failure/);
        if (mutation === 'early') assert.deepEqual(consumed, []);
        else assert.deepEqual(consumed, mutation === 'std-failure' ? [true] : [true, false]);
        if (mutation !== 'early') assert.equal(readFileSync(second)[0], 2);
        if (mutation === 'unlink-error') {
          assert.equal(lstatSync(first, {throwIfNoEntry: false}), undefined);
          assert.throws(() => owner.retire(), /sealed unretired/);
        }
        if (mutation !== 'early') assert.throws(() => owner.assertRetired(), /retirement required/);
      }
    }
  } finally {rmSync(work, {recursive: true, force: true});}
});
