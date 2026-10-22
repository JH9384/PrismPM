import assert from 'node:assert/strict';
import test from 'node:test';
import {openSignedContext} from '../../sdk/browser/signed-context.mjs';

test('signed-context bootstrap refuses accessor options without invoking them', async () => {
  let reads = 0;
  const options = {wireDigest: new Uint8Array(32)};
  Object.defineProperty(options, 'wire', {enumerable: true, get() {reads++; throw Error('getter');}});
  await assert.rejects(openSignedContext(options), {code: 'invalid-input'});
  assert.equal(reads, 0);
});

test('signed-context bootstrap has closed options and cannot accept digest-only evidence', async () => {
  for (const options of [null, [], Object.create(null), {},
    {wire: new Uint8Array(), wireDigest: new Uint8Array(31)},
    {wire: new Uint8Array(), wireDigest: new Uint8Array(32), verified: true}]) {
    await assert.rejects(openSignedContext(options), {code: 'invalid-input'});
  }
  await assert.rejects(openSignedContext({wire: new Uint8Array(), wireDigest: new Uint8Array(32)}),
    {code: 'artifact-mismatch'});
});
