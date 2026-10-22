// Independent finite protocol examples and canonical encoder; not a runtime.
import assert from 'node:assert/strict';
import {oraclePoints} from '../browser-p256/oracles.mjs';
import {parameters} from '../browser-p256/parameters.mjs';

export function encode(value) {
  const head = (major, value) => {
    assert.ok(Number.isSafeInteger(value) && value >= 0);
    if (value < 24) return Buffer.from([major * 32 + value]);
    const width = value <= 255 ? 1 : value <= 65535 ? 2 : value <= 0xffffffff ? 4 : 8;
    const bytes = Buffer.alloc(1 + width); bytes[0] = major * 32 + ({1: 24, 2: 25, 4: 26, 8: 27})[width];
    if (width === 8) {bytes.writeUInt32BE(Math.floor(value / 0x100000000), 1); bytes.writeUInt32BE(value % 0x100000000, 5);}
    else bytes.writeUIntBE(value, 1, width);
    return bytes;
  };
  if (typeof value === 'boolean') return Buffer.from([value ? 245 : 244]);
  if (typeof value === 'number') return head(0, value);
  if (typeof value === 'string') {const text = Buffer.from(value); return Buffer.concat([head(3, text.length), text]);}
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  assert.ok(Array.isArray(value)); return Buffer.concat([head(4, value.length), ...value.map(encode)]);
}
export const domains = Object.freeze(['prismpm/account-binding/1', 'prismpm/account-request/1',
  'prismpm/organization-approval/1', 'prismpm/session-journal-context/1']);
export const bytes = (length, value = 1) => new Uint8Array(length).fill(value);
export const context = (purpose = 0, epoch = 0xffffffff) => [Array.from({length: 6}, (_, i) => bytes(32, i)),
  bytes(32, 7), purpose, bytes(32, 8), bytes(32, 9), bytes(32, 10), bytes(32, 11), epoch, bytes(32, 12)];
export const publicKey = () => Uint8Array.from(Buffer.from(parameters.generator, 'hex'));
export const otherPublicKey = () => {
  const key = Buffer.from(parameters.generator, 'hex');
  const y = BigInt('0x' + key.subarray(33).toString('hex'));
  Buffer.from((BigInt('0x' + parameters.p) - y).toString(16).padStart(64, '0'), 'hex').copy(key, 33);
  return Uint8Array.from(key);
};
export function pointCases() {
  const rows = oraclePoints().map(row => ({id: row.source + row.id, key: row.key, valid: row.valid}));
  rows.push({id: 'OppositeGenerator', key: otherPublicKey(), valid: true});
  rows.push({id: 'FormerShapeOnlyFixture', key: Uint8Array.from([4, ...bytes(64, 17)]), valid: false});
  rows.push({id: 'ZeroCoordinates', key: Uint8Array.from([4, ...bytes(64, 0)]), valid: false});
  for (const value of [BigInt('0x' + parameters.p), BigInt('0x' + parameters.p) + 1n, (1n << 256n) - 1n])
    for (const axis of [1, 33]) {
      const key = Buffer.from(publicKey());
      Buffer.from(value.toString(16).padStart(64, '0'), 'hex').copy(key, axis);
      rows.push({id: 'Coordinate' + axis + '_' + value.toString(16), key, valid: false});
    }
  for (let at = 1; at <= 64; at++) {
    const key = publicKey(); key[at] ^= 1;
    rows.push({id: 'OffCurveBit' + at, key, valid: false});
  }
  assert.equal(rows.length, 88);
  return rows;
}
export const envelope = (value = context(), key = publicKey(), signature = bytes(64, 18)) => [1, value, key, signature];
export const success = value => [1, 0, value];
export const rejected = code => [1, 1, code];
export const malformed = code => [1, 2, code];
export const projection = value => [value[2], domains[value[1][2]], encode(value.slice(0, 3)), value[3]];

export function corpus() {
  const rows = [];
  const add = (id, request, response) => rows.push({id, request: encode(request), response: encode(response)});
  const raw = (id, request, response) => rows.push({id, request: Buffer.from(request), response: encode(response)});
  for (let purpose = 0; purpose < 4; purpose++) for (const epoch of [0, 23, 24, 255, 256, 65535, 65536, 0xffffffff]) {
    const value = envelope(context(purpose, epoch));
    add(`Roundtrip${purpose}_${epoch}`, [1, 0, value], success(value));
    add(`Projection${purpose}_${epoch}`, [1, 1, value], success(projection(value)));
    add(`Match${purpose}_${epoch}`, [1, 2, value[1], value[2], value], success(true));
  }
  for (const fill of [0, 255]) {
    const value = envelope();
    value[1][0] = value[1][0].map(() => bytes(32, fill));
    for (const index of [1, 3, 4, 5, 6, 8]) value[1][index] = bytes(32, fill);
    add(`ReferenceBoundary${fill}`, [1, 0, value], success(value));
  }
  for (let index = 0; index < 6; index++) {
    const value = envelope(), changed = structuredClone(value[1]); changed[0][index][0] ^= 128;
    add(`BindingMismatch${index}`, [1, 2, changed, value[2], value], rejected(3));
    for (const length of [0, 31, 33]) {
      const bad = envelope(); bad[1][0][index] = bytes(length);
      add(`BindingWidth${index}_${length}`, [1, 0, bad], rejected(0));
    }
  }
  for (const index of [1, 3, 4, 5, 6, 8]) {
    const value = envelope(), changed = structuredClone(value[1]); changed[index][0] ^= 128;
    add(`ContextMismatch${index}`, [1, 2, changed, value[2], value], rejected(3));
    for (const length of [0, 31, 33]) {
      const bad = envelope(); bad[1][index] = bytes(length);
      add(`ContextWidth${index}_${length}`, [1, 0, bad], rejected(0));
    }
  }
  for (const index of [2, 7]) {
    const value = envelope(), changed = structuredClone(value[1]); changed[index] = index === 2 ? 1 : 0;
    add(`ContextMismatch${index}`, [1, 2, changed, value[2], value], rejected(3));
    const bad = envelope(); bad[1][index] = index === 2 ? 4 : 0x100000000;
    // The imported canonical primitive rejects eight-byte integer arguments
    // before any domain admission; purpose4 remains structurally readable.
    add(`ContextRange${index}`, [1, 0, bad], index === 7 ? malformed(4) : rejected(0));
    add(`ExpectedRange${index}`, [1, 2, bad[1], value[2], value], index === 7 ? malformed(4) : rejected(0));
  }
  for (const length of [0, 64, 66]) {
    const value = envelope(context(), bytes(length));
    add(`KeyWidth${length}`, [1, 0, value], rejected(1));
  }
  for (const prefix of [0, 2, 3, 5, 255]) {
    const value = envelope(); value[2][0] = prefix;
    add(`KeyPrefix${prefix}`, [1, 0, value], rejected(1));
  }
  for (const length of [0, 63, 65]) add(`SignatureWidth${length}`,
    [1, 0, envelope(context(), publicKey(), bytes(length))], rejected(2));
  for (const row of pointCases()) {
    const value = envelope(context(), row.key);
    add('PointRoundtrip' + row.id, [1, 0, value], row.valid ? success(value) : rejected(1));
    add('PointProjection' + row.id, [1, 1, value], row.valid ? success(projection(value)) : rejected(1));
    add('PointMatch' + row.id, [1, 2, value[1], row.key, value], row.valid ? success(true) : rejected(1));
    add('PointExpected' + row.id, [1, 2, value[1], row.key, envelope()],
      row.valid ? Buffer.from(row.key).equals(Buffer.from(publicKey())) ? success(true) : rejected(4) : rejected(1));
  }
  const value = envelope(), changedKey = otherPublicKey();
  add('KeyMismatch', [1, 2, value[1], changedKey, value], rejected(4));
  add('ExpectedKeyShape', [1, 2, value[1], bytes(65), value], rejected(1));
  const badBoth = envelope(); badBoth[1][2] = 4; badBoth[2][0] = 0; badBoth[3] = bytes(0);
  add('ContextErrorPrecedence', [1, 0, badBoth], rejected(0));
  badBoth[1][2] = 0; add('KeyErrorPrecedence', [1, 0, badBoth], rejected(1));
  badBoth[2][0] = 4; add('SignatureErrorPrecedence', [1, 0, badBoth], rejected(2));
  badBoth[2] = Uint8Array.from([4, ...bytes(64, 17)]);
  add('PointErrorBeforeSignature', [1, 0, badBoth], rejected(1));
  add('Operation', [1, 3, value], rejected(5));
  add('Version', [2, 0, value], malformed(3));
  const envelopeVersion = envelope(); envelopeVersion[0] = 2;
  add('EnvelopeVersion', [1, 0, envelopeVersion], malformed(3));
  add('RequestShortArity', [1, 0], malformed(3));
  add('RequestLongArity', [1, 0, value, value], malformed(3));
  add('ContextArity', [1, 0, [1, value[1].slice(0, 8), value[2], value[3]]], malformed(3));
  add('BindingArity', [1, 0, [1, [value[1][0].slice(0, 5), ...value[1].slice(1)], value[2], value[3]]], malformed(3));
  add('EnvelopeArity', [1, 0, value.slice(0, 3)], malformed(3));
  const wire = encode([1, 2, value[1], value[2], value]); assert.equal(wire.length, 1037);
  for (let cut = 0; cut < wire.length; cut++) raw(`Truncated${cut}`, wire.subarray(0, cut), malformed(2));
  raw('Trailing', Buffer.concat([wire, Buffer.from([0])]), malformed(8));
  raw('NoncanonicalVersion', [0x85, 0x18, 1, ...wire.subarray(2)], malformed(5));
  raw('IndefiniteArray', [0x9f, ...wire.subarray(1), 0xff], malformed(4));
  raw('ArrayLimit', [0x86], malformed(6));
  raw('WrongRootType', [0x40], malformed(3));
  raw('FrameMaximum', bytes(2048), malformed(3));
  raw('FrameOverflow', bytes(2049), malformed(6));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
