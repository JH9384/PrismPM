import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeRetentionWire as encode, decodeRetentionWire as decode} from '../../sdk/browser/session-retention-wire.mjs';
import {encodeEffectWire, decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';

const ref = value => { const bytes = new Uint8Array(32); new DataView(bytes.buffer).setUint32(28, value); return bytes; };
test('retention framing represents every root reference at the actual joint maximum', () => {
  const objects = Array.from({length: 4096}, (_, i) => ref(i));
  const roots = Array.from({length: 64}, (_, i) => ['root' + i.toString().padStart(2, '0'), objects[i], objects]);
  const snapshot = [1, 0xffffffff, objects, roots];
  const bytes = encode(snapshot), actual = decode(bytes);
  assert.deepEqual(actual, snapshot); assert.ok(bytes.length < 67108864);
  const request = [1, 0, snapshot, [1, ['root00', [1, objects[0]], objects[1], objects]], objects.slice(0, 16), objects];
  assert.deepEqual(decode(encode(request)), request, 'full structural domain; the model independently rejects unsafe retirement');
  assert.throws(() => encodeEffectWire(snapshot), /invalid-effect-wire/);
  assert.throws(() => decodeEffectWire(bytes), /invalid-effect-wire/, 'existing effect profile is unchanged');
});

test('retention framing rejects malformed, oversized and noncanonical CBOR before model admission', () => {
  for (const bytes of [Uint8Array.of(0x18, 1), Uint8Array.of(0x9f, 0xff), Uint8Array.of(0x83, 1),
    Uint8Array.of(0x40, 0), Uint8Array.of(0x20), Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff),
    Uint8Array.of(0x61, 0xff), Uint8Array.of(0x9a, 0, 0, 0x10, 1)]) assert.throws(() => decode(bytes));
  for (const value of [new Uint8Array(33), 'x'.repeat(129), Array(4097).fill(0), -1, 0x100000000,
    1.5, undefined, null, '\ud800', Object.assign([0], {extra: 1}), Array(1)]) assert.throws(() => encode(value));
  let nested = 0; for (let i = 0; i < 10; i++) nested = [nested];
  assert.throws(() => encode(nested));
  const accessor = []; Object.defineProperty(accessor, '0', {get() {throw Error('getter executed');}, enumerable: true});
  assert.throws(() => encode(accessor), /invalid-retention-wire/);
});

test('retention framing copies input and output buffers and preserves canonical scalar boundaries', () => {
  const payload = ref(4), value = [1, [0, 23, 24, 255, 256, 65535, 65536, 0xffffffff], payload, true, false, 'a'];
  const expected = structuredClone(value), bytes = encode(value); payload.fill(9);
  const decoded = decode(bytes); bytes.fill(0); assert.deepEqual(decoded, expected);
  assert.deepEqual(decode(encode(decoded)), expected);
});
