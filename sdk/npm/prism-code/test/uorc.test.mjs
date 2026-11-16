// Holo v5 is a raw UORC archive (ADR-017): this reader and the uorc CLI must see the same archive.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DigestMismatchError } from '../src/errors.mjs';
import { chain, kappa, layout, readObjects, writeObjects } from '../src/uorc.mjs';

const root = new URL('../../../../', import.meta.url);
const oracle = JSON.parse(readFileSync(new URL('tests/data/holo-v5-uorc-oracle.json', root), 'utf8'));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('κ is the sha256 label', () => {
  assert.equal(kappa(new TextEncoder().encode('abc')), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('layout and seal agree with what uorc inspect reports for every fixture', () => {
  for (const archive of oracle.archives) {
    const bytes = new Uint8Array(readFileSync(new URL(archive.path, root)));
    const { objects, sealed, seal } = layout(bytes);
    assert.equal(sealed, archive.integrity_ok, archive.path);
    assert.equal(bytes.length, archive.archive_bytes, archive.path);
    assert.deepEqual(objects.map((o) => o.length), archive.object_lengths, archive.path);
    assert.equal(hex(seal), archive.digest, archive.path);
  }
});

test('objects round trip, the seal covers every tail length, and any changed byte is refused', () => {
  for (const length of [0, 1, 55, 63, 64, 65, 127, 128, 129]) {
    const object = new Uint8Array(length).fill(0xa5);
    const archive = writeObjects([object, new Uint8Array(0)]);
    assert.deepEqual(hex(chain(archive.subarray(0, archive.length - 32))), hex(archive.subarray(archive.length - 32)));
    assert.deepEqual(readObjects(archive).map(hex), [hex(object), '']);
  }
  const archive = writeObjects([new TextEncoder().encode('guest')]);
  for (let i = 6; i < archive.length; i += 1) {
    const bad = archive.slice();
    bad[i] ^= 1;
    assert.throws(() => readObjects(bad), DigestMismatchError, `byte ${i}`);
  }
});
