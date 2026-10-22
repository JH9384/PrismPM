// Independent finite protocol examples and canonical encoder; not a runtime.
import assert from 'node:assert/strict';
import {createECDH, ECDH} from 'node:crypto';
import {oraclePoints} from '../browser-p256/oracles.mjs';

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

export const domain = Buffer.from('prismpm/account-genesis/1\0', 'ascii');
export const bytes = (length, fill = 1) => Buffer.alloc(length, fill);
export const publicKey = () => Buffer.from('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5', 'hex');
// Public, deterministic test fixtures only; never production account keys.
export function validPublicKey(index) {
  assert.ok(Number.isInteger(index) && index >= 1 && index <= 65);
  const scalar = Buffer.alloc(32); scalar.writeUInt32BE(index, 28);
  const oracle = createECDH('prime256v1'); oracle.setPrivateKey(scalar);
  return oracle.getPublicKey(undefined, 'uncompressed');
}
export const CORPUS_CASES = 529;
export const genesis = () => [1, bytes(32, 1), bytes(32, 2), publicKey()];
export const projection = value => [value[1], value[3], encode(value), Buffer.concat([domain, encode(value)])];
const success = value => [1, 0, value], rejected = code => [1, 1, code], malformed = code => [1, 2, code];

export function corpus() {
  const rows = [];
  const add = (id, request, response) => rows.push({id, request: encode(request), response: encode(response)});
  const raw = (id, request, response) => rows.push({id, request: Buffer.from(request), response: encode(response)});
  const base = genesis();
  for (const fill of [0, 1, 23, 24, 127, 128, 255]) {
    const value = genesis(); value[1].fill(fill); value[2].fill(255 - fill);
    add('Roundtrip' + fill, [1, 0, value], success(value));
    add('Projection' + fill, [1, 1, value], success(projection(value)));
    add('Match' + fill, [1, 2, value[1], value], success(true));
  }
  for (let index = 0; index < 32; index++) {
    const expected = Buffer.from(base[1]); expected[index] ^= 1;
    add('NamespaceMismatch' + index, [1, 2, expected, base], rejected(3));
    for (const field of [1, 2]) {
      const value = genesis(); value[field][index] ^= 1;
      add('IdentityByte' + field + '_' + index, [1, 1, value], success(projection(value)));
    }
  }
  for (let index = 1; index < 65; index++) {
    const value = genesis(); value[3][index] ^= 1;
    assert.throws(() => ECDH.convertKey(value[3], 'prime256v1', undefined, undefined, 'uncompressed'));
    add('InitialKeyByte' + index, [1, 1, value], rejected(2));
    const valid = genesis(); valid[3] = validPublicKey(index + 1);
    add('InitialValidKey' + index, [1, 1, valid], success(projection(valid)));
  }
  const fieldMaximum = Buffer.from('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff', 'hex');
  const above = Buffer.from(fieldMaximum); above.writeUInt32BE(0x00000001, 12);
  const invalidPoints = [['ZeroPoint', Buffer.concat([Buffer.from([4]), bytes(64, 0)])],
    ['Infinity', Buffer.from([0])], ['Compressed', ECDH.convertKey(publicKey(), 'prime256v1', undefined, undefined, 'compressed')],
    ['Hybrid', Buffer.concat([Buffer.from([6]), publicKey().subarray(1)])]];
  for (const [name, coordinate] of [['EqualsP', fieldMaximum], ['AboveP', above], ['Maximum', bytes(32, 255)]]) {
    for (const [axis, offset] of [['X', 1], ['Y', 33]]) {
      const key = publicKey(); coordinate.copy(key, offset);
      assert.throws(() => ECDH.convertKey(key, 'prime256v1', undefined, undefined, 'uncompressed'));
      invalidPoints.push(['Coordinate' + axis + name, key]);
    }
  }
  assert.equal(invalidPoints.length, 10);
  for (const [id, key] of invalidPoints) for (const operation of [0, 1, 2]) {
    const value = genesis(); value[3] = key;
    add(id + '_' + operation, operation === 2 ? [1, operation, value[1], value] : [1, operation, value], rejected(2));
  }
  // Every P-256 case from both complete pinned supplier files reaches every
  // source operation. Oversized original coordinates are never truncated.
  const supplied = oraclePoints(); assert.equal(supplied.length, 15);
  for (const point of supplied) for (const operation of [0, 1, 2]) {
    const value = genesis(); value[3] = point.key;
    const response = point.valid
      ? success(operation === 0 ? value : operation === 1 ? projection(value) : true)
      : point.key.length > 65 ? malformed(6) : rejected(2);
    add('Oracle_' + point.source + '_' + point.id + '_' + operation,
      operation === 2 ? [1, operation, value[1], value] : [1, operation, value], response);
  }
  for (const field of [1, 2, 3]) for (const length of [0, field === 3 ? 64 : 31, field === 3 ? 66 : 33]) {
    const value = genesis(); value[field] = bytes(length); if (field === 3 && length) value[field][0] = 4;
    add('FieldWidth' + field + '_' + length, [1, 0, value],
      length > (field === 3 ? 65 : 32) ? malformed(6) : rejected(field - 1));
  }
  for (const length of [0, 31, 33])
    add('ExpectedNamespaceWidth' + length, [1, 2, bytes(length), base], length > 32 ? malformed(6) : rejected(0));
  for (const prefix of [0, 2, 3, 5, 255]) {
    const value = genesis(); value[3][0] = prefix;
    add('KeyPrefix' + prefix, [1, 0, value], rejected(2));
  }
  const allBad = [1, bytes(0), bytes(0), bytes(0)];
  add('NamespaceErrorPrecedence', [1, 0, allBad], rejected(0));
  allBad[1] = bytes(32); add('NonceErrorPrecedence', [1, 0, allBad], rejected(1));
  allBad[2] = bytes(32); add('KeyErrorPrecedence', [1, 0, allBad], rejected(2));
  add('Operation', [1, 3, base], rejected(4));
  add('RequestVersion', [2, 0, base], malformed(3));
  add('GenesisVersion', [1, 0, [2, ...base.slice(1)]], malformed(3));
  add('RequestShortArity', [1, 0], malformed(3));
  add('RequestLongArity', [1, 0, base, base], malformed(3));
  add('MatchShortArity', [1, 2, base], malformed(3));
  add('GenesisShortArity', [1, 0, base.slice(0, 3)], malformed(3));
  add('GenesisLongArity', [1, 0, [...base, 0]], malformed(6));
  const wire = encode([1, 2, base[1], base]);
  assert.equal(wire.length, 174);
  for (let cut = 0; cut < wire.length; cut++) raw('Truncated' + cut, wire.subarray(0, cut), malformed(2));
  raw('Trailing', Buffer.concat([wire, Buffer.from([0])]), malformed(8));
  raw('NoncanonicalVersion', [0x84, 0x18, 1, ...wire.subarray(2)], malformed(5));
  raw('IndefiniteArray', [0x9f, ...wire.subarray(1), 0xff], malformed(4));
  raw('ArrayLimit', [0x85], malformed(6));
  raw('WrongRootType', [0x40], malformed(3));
  raw('FrameMaximum', bytes(512), malformed(3));
  raw('FrameOverflow', bytes(513), malformed(6));
  assert.equal(encode(base).length, 137);
  assert.equal(domain.length, 26);
  assert.equal(projection(base)[3].length, 163);
  assert.equal(encode(success(projection(base))).length, 409);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(rows.length, CORPUS_CASES);
  return rows;
}
