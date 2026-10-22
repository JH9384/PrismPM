import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeEffectWire} from '../../sdk/browser/effects-wire.mjs';

const FRAME = 67108864;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.slice().sort(), 'closed observed byte representation');

export function restoreObserved(record, role) {
  assert.ok(['Effects', 'Guest', 'Custody'].includes(role), 'closed actual artifact role');
  keys(record, ['length', 'sha256', 'value']);
  assert.ok(Number.isSafeInteger(record.length) && record.length >= 0 && record.length <= FRAME, 'bounded actual observed frame');
  assert.match(record.sha256, /^[0-9a-f]{64}$/);
  let bytes = 0, nodes = 0;
  function inspect(value, depth) {
    assert.ok(++nodes <= 4096 && depth <= 16, 'bounded observed frame structure');
    if (Array.isArray(value)) { assert.ok(value.length <= 4096); for (const item of value) inspect(item, depth + 1); return; }
    if (value !== null && typeof value === 'object') {
      if (Object.hasOwn(value, 'hex')) {
        keys(value, ['hex']); assert.equal(typeof value.hex, 'string');
        assert.ok(value.hex.length <= 131072 && /^(?:[0-9a-f]{2})*$/.test(value.hex), 'bounded canonical byte hex');
        bytes += value.hex.length / 2;
      } else {
        keys(value, ['runs', 'length']);
        assert.ok(Number.isSafeInteger(value.length) && value.length > 65536 && value.length <= FRAME);
        assert.ok(Array.isArray(value.runs) && value.runs.length >= 1 && value.runs.length <= 64);
        let length = 0, previous = -1;
        for (const run of value.runs) {
          assert.ok(Array.isArray(run) && run.length === 2 && Number.isSafeInteger(run[0]) && run[0] > 0
            && Number.isSafeInteger(run[1]) && run[1] >= 0 && run[1] <= 255 && run[1] !== previous, 'canonical positive bounded byte run');
          length += run[0]; assert.ok(Number.isSafeInteger(length) && length <= value.length, 'run arithmetic cannot overflow'); previous = run[1];
        }
        assert.equal(length, value.length, 'complete runs, no missing or trailing payload'); bytes += length;
      }
    } else if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else assert.ok(typeof value === 'boolean' || Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff, 'closed observed scalar');
    assert.ok(bytes <= FRAME, 'aggregate byte bound before any restoration allocation');
  }
  inspect(record.value, 0);
  function unpack(value) {
    if (Array.isArray(value)) return value.map(unpack);
    if (value !== null && typeof value === 'object') {
      if (Object.hasOwn(value, 'hex')) return new Uint8Array(Buffer.from(value.hex, 'hex'));
      const result = new Uint8Array(value.length); let offset = 0;
      for (const [count, byte] of value.runs) { result.fill(byte, offset, offset + count); offset += count; }
      return result;
    }
    return value;
  }
  const value = unpack(record.value);
  if (role === 'Guest') assert.ok(value instanceof Uint8Array, 'raw actual guest bytes');
  const result = role === 'Guest' ? value : encodeEffectWire(value);
  assert.equal(result.length, record.length, 'restored exact actual browser frame length');
  assert.equal(sha(result), record.sha256, 'restored exact actual browser frame SHA256');
  return result;
}

export function verifyTranscriptDecoder() {
  const value = {runs: [[65537, 7]], length: 65537};
  const record = {length: 65537, sha256: sha(Buffer.alloc(65537, 7)), value};
  assert.deepEqual(restoreObserved(record, 'Guest'), new Uint8Array(65537).fill(7));
  for (const mutate of [
    row => row.length++, row => row.sha256 = '0'.repeat(64), row => row.extra = 1,
    row => row.value.extra = 1, row => row.value.length++, row => row.value.runs[0][0]--,
    row => row.value.runs[0][0] = 0, row => row.value.runs[0][0] = Number.MAX_SAFE_INTEGER,
    row => row.value.runs[0][1] = 256, row => row.value.runs.push([1, 7]),
    row => row.value.runs[0].push(0), row => row.value.runs[0][0] = '65537',
    row => row.value.runs = Array.from({length: 65}, () => [1, 0]),
    row => row.value = {hex: '0'}, row => row.value = {hex: 'FF'},
    row => row.value = [{runs:[[FRAME,1]],length:FRAME},{runs:[[FRAME,2]],length:FRAME}],
  ]) { const changed = structuredClone(record); mutate(changed); assert.throws(() => restoreObserved(changed, 'Guest')); }
  assert.throws(() => restoreObserved(record, 'Unknown'));
  const encoded = encodeEffectWire([1, new Uint8Array(65537).fill(7)]);
  assert.deepEqual(restoreObserved({length: encoded.length, sha256: sha(encoded), value: [1, value]}, 'Effects'), encoded);
}
