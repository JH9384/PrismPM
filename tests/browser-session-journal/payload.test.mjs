import assert from 'node:assert/strict';
import test from 'node:test';
import {sessionStorageAccess} from '../../sdk/browser/session-storage.mjs';
import {openSessionPayloads} from '../../sdk/browser/session-payloads.mjs';

test('payload transport rejects fabricated storage without invoking caller methods', async () => {
  let calls = 0;
  const fake = Object.freeze(Object.fromEntries(['snapshot', 'commit', 'read', 'close']
    .map(name => [name, () => {calls++; throw new Error('caller storage');}])));
  for (const storage of [fake, {...fake}, null, {}, new Proxy(fake, {})]) {
    assert.throws(() => sessionStorageAccess(storage), /invalid-input/);
    await assert.rejects(openSessionPayloads({storage, wire: new Uint8Array(),
      wireDigest: new Uint8Array(32), partition: new Uint8Array(), partitionDigest: new Uint8Array(32)}), /invalid-input/);
  }
  assert.equal(calls, 0);
});
