// The reference grammar of push and pull (#292).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReference, formatReference } from '../src/oci-reference.mjs';
import { ReferenceInvalidError } from '../src/errors.mjs';

const HEX = 'a'.repeat(64);

test('a registry reference: host, repository, tag and digest', () => {
  assert.deepEqual(parseReference('ghcr.io/acme/calculator:1.0'), { kind: 'registry', text: 'ghcr.io/acme/calculator:1.0', registry: 'ghcr.io', repository: 'acme/calculator', tag: '1.0', digest: null, fingerprint: null });
  const latest = parseReference('ghcr.io/acme/calculator');
  assert.equal(latest.tag, 'latest');
  const port = parseReference('localhost:5000/calculator');
  assert.equal(port.registry, 'localhost:5000');
  assert.equal(port.repository, 'calculator');
  assert.equal(port.tag, 'latest');
  assert.equal(parseReference('[::1]:5000/calc:v1').registry, '[::1]:5000');
  assert.equal(parseReference('GHCR.io/acme/app').registry, 'ghcr.io');
});

test('a digest pins the manifest and a tag next to it is kept but does not address', () => {
  const pinned = parseReference(`ghcr.io/acme/app@sha256:${HEX}`);
  assert.equal(pinned.digest, `sha256:${HEX}`);
  assert.equal(pinned.tag, null);
  const both = parseReference(`ghcr.io/acme/app:1.0@sha256:${HEX}`);
  assert.equal(both.tag, '1.0');
  assert.equal(both.digest, `sha256:${HEX}`);
});

test('a BLAKE3 fingerprint is its own address, not a manifest digest', () => {
  const reference = parseReference(`ghcr.io/acme/app@blake3:${HEX}`);
  assert.equal(reference.fingerprint, `blake3:${HEX}`);
  assert.equal(reference.digest, null);
});

test('a store reference: dir:// with a tag or a digest, and drive letters are not tags', () => {
  const tagged = parseReference('dir://./store:v1');
  assert.deepEqual([tagged.kind, tagged.path, tagged.tag, tagged.repository], ['store', './store', 'v1', null]);
  assert.equal(parseReference('dir://./store').tag, 'latest');
  const pinned = parseReference(`dir://./store@sha256:${HEX}`);
  assert.deepEqual([pinned.path, pinned.digest, pinned.tag], ['./store', `sha256:${HEX}`, null]);
  const fingerprint = parseReference(`dir://./store@blake3:${HEX}`);
  assert.equal(fingerprint.fingerprint, `blake3:${HEX}`);
  const drive = parseReference('dir://C:\\work\\store');
  assert.deepEqual([drive.path, drive.tag], ['C:\\work\\store', 'latest']);
  const both = parseReference('dir://C:/work/store:v2');
  assert.deepEqual([both.path, both.tag], ['C:/work/store', 'v2']);
  const bare = parseReference('dir://C:');
  assert.deepEqual([bare.path, bare.tag], ['C:', 'latest']);
});

test('--store makes the text a name in that store, and the name may be registry-qualified', () => {
  const short = parseReference('calculator:v1', { store: '/tmp/store' });
  assert.deepEqual([short.kind, short.path, short.repository, short.tag], ['store', '/tmp/store', 'calculator', 'v1']);
  const full = parseReference('ghcr.io/acme/app:1', { store: '/tmp/store' });
  assert.deepEqual([full.repository, full.tag], ['ghcr.io/acme/app', '1']);
});

test('formatReference gives back what a person can paste', () => {
  assert.equal(formatReference(parseReference('ghcr.io/acme/app:1')), 'ghcr.io/acme/app:1');
  assert.equal(formatReference(parseReference('ghcr.io/acme/app:1'), `sha256:${HEX}`), `ghcr.io/acme/app@sha256:${HEX}`);
  assert.equal(formatReference(parseReference('dir://./s:1')), 'dir://./s:1');
  assert.equal(formatReference(parseReference('app:1', { store: 's' })), 'app:1');
});

test('every refusal is a ReferenceInvalidError with its own check', () => {
  const cases = [
    ['', 'reference.syntax'],
    ['calculator:v1', 'reference.registry'],
    ['acme/calculator:v1', 'reference.registry'],
    ['-bad.io/app', 'reference.registry'],
    ['ghcr.io/Acme/app', 'reference.repository'],
    ['ghcr.io/acme//app', 'reference.repository'],
    ['ghcr.io/acme/app:', 'reference.tag'],
    ['ghcr.io/acme/app:bad tag', 'reference.tag'],
    [`ghcr.io/acme/app:${'x'.repeat(129)}`, 'reference.tag'],
    ['ghcr.io/acme/app@sha256:abc', 'reference.digest'],
    [`ghcr.io/acme/app@sha512:${HEX}`, 'reference.digest'],
    [`ghcr.io/acme/app@sha256:${'A'.repeat(64)}`, 'reference.digest'],
    ['dir://', 'reference.store'],
    ['dir://./store@sha256:abc', 'reference.digest'],
    ['dir://./store:bad tag', 'reference.tag'],
  ];
  for (const [text, check] of cases) {
    assert.throws(() => parseReference(text), (error) => error instanceof ReferenceInvalidError && error.code === 'reference_invalid' && error.check === check, text);
  }
  assert.throws(() => parseReference('dir://./s:1', { store: './s' }), (error) => error.check === 'reference.store');
  assert.throws(() => parseReference('Bad:1', { store: './s' }), (error) => error.check === 'reference.repository');
});
