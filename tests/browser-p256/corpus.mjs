// Independent BigInt/OpenSSL test oracles; never imported by the SDK runtime.
import assert from 'node:assert/strict';
import {createECDH, createHash, ECDH} from 'node:crypto';
import {oraclePoints} from './oracles.mjs';
import {parameters} from './parameters.mjs';
export const prime = BigInt('0x' + parameters.p);
export const CORPUS_CASES = 1505;
export function encode(value) {
  const head = (major, value) => {
    assert.ok(Number.isSafeInteger(value) && value >= 0);
    if (value < 24) return Buffer.from([major * 32 + value]);
    const width = value <= 255 ? 1 : value <= 65535 ? 2 : value <= 0xffffffff ? 4 : 8;
    const bytes = Buffer.alloc(1 + width); bytes[0] = major * 32 + ({1:24,2:25,4:26,8:27})[width];
    if (width === 8) bytes.writeBigUInt64BE(BigInt(value), 1); else bytes.writeUIntBE(value, 1, width);
    return bytes;
  };
  if (typeof value === 'boolean') return Buffer.from([value ? 245 : 244]);
  if (typeof value === 'number') return head(0, value);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  assert.ok(Array.isArray(value)); return Buffer.concat([head(4, value.length), ...value.map(encode)]);
}
export const fieldBytes = value => {
  assert.ok(value >= 0n && value < 1n << 256n);
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
};
export const limbs = value => Array.from({length:17}, (_, index) => Number(value >> BigInt(index * 16) & 65535n));
export const publicKey = () => Buffer.from(parameters.generator, 'hex');
export function nativePointValid(key) {
  if (key.length !== 65 || key[0] !== 4) return false;
  try { ECDH.convertKey(key, 'prime256v1', undefined, undefined, 'uncompressed'); return true; } catch { return false; }
}
export function validPublicKey(index) {
  const scalar = Buffer.alloc(32); scalar.writeUInt32BE(index, 28);
  const key = createECDH('prime256v1'); key.setPrivateKey(scalar);
  return key.getPublicKey(undefined, 'uncompressed');
}
export function corpus() {
  const rows = [], add = (id, request, response) => rows.push({id, request: encode(request), response: encode(response)});
  const raw = (id, request, response) => rows.push({id, request: Buffer.from(request), response: encode(response)});
  const point = (id, key, valid = nativePointValid(key)) => add(id, [1, 0, key], [1, 0, valid]);
  for (const row of oraclePoints()) point(row.source + row.id, row.key, row.valid);
  for (let scalar = 1; scalar <= 65; scalar++) point('ValidPoint' + scalar, validPublicKey(scalar), true);
  const key = publicKey();
  for (let length = 0; length <= 66; length++) if (length !== 65) {
    const changed = Buffer.alloc(length); key.copy(changed); point('PointLength' + length, changed, false);
  }
  for (let prefix = 0; prefix <= 255; prefix++) if (prefix !== 4) {
    const changed = Buffer.from(key); changed[0] = prefix; point('PointPrefix' + prefix, changed, false);
  }
  for (let at = 1; at <= 64; at++) {const changed = Buffer.from(key); changed[at] ^= 1;
    assert.equal(nativePointValid(changed), false); point('PointBit' + at, changed, false);}
  for (const value of [0n, 1n, prime - 1n, prime, prime + 1n, (1n << 256n) - 1n]) for (const axis of [1, 33]) {
    const changed = Buffer.from(key); fieldBytes(value).copy(changed, axis);
    point('Coordinate' + axis + '_' + value.toString(16), changed);
  }
  const values = [0n,1n,2n,3n,65535n,65536n,65537n,prime-1n,prime-2n,
    ...[31n,32n,63n,64n,127n,128n,255n].map(bit => 1n << bit)];
  const arithmetic = (stem, left, right) => {
    for (const operation of [1, 2, 3]) {
      const answer = operation === 1 ? (left + right) % prime : operation === 2
        ? (left - right + prime) % prime : left * right % prime;
      add(stem + '_' + operation, [1, operation, fieldBytes(left), fieldBytes(right)], [1, 0, fieldBytes(answer)]);
    }
  };
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) arithmetic('Field' + i + '_' + j, values[i], values[j]);
  for (let i = 0; i < 32; i++) {
    const hash = suffix => BigInt('0x' + createHash('sha256').update('DK34/' + i + '/' + suffix).digest('hex')) % prime;
    arithmetic('Independent' + i, hash('left'), hash('right'));
  }
  const badFields = [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33), fieldBytes(prime), fieldBytes(prime+1n), Buffer.alloc(32,255)];
  for (let i = 0; i < badFields.length; i++) for (const side of [0, 1]) for (const op of [1,2,3]) {
    const args = [fieldBytes(0n), fieldBytes(0n)]; args[side] = badFields[i];
    add('InvalidField' + i + '_' + side + '_' + op, [1, op, ...args], [1, 1, 0]);
  }
  for (const [id,value] of [['Zero',0n],['GeneratorX',BigInt('0x'+parameters.generator.slice(2,66))],['Max',prime-1n]])
    add('Limbs' + id, [1,4,limbs(value)], [1,0,true]);
  for (const count of [0,1,16,18]) add('LimbCount' + count,[1,4,Array(count).fill(0)],count>17?[1,2,6]:[1,0,false]);
  for (let i=0;i<17;i++) for (const invalid of [65536,4294967295]) {
    const values=limbs(0n); values[i]=invalid; add('LimbValue'+i+'_'+invalid,[1,4,values],[1,0,false]);
  }
  const top=limbs(0n);top[16]=1;add('LimbHigh',[1,4,top],[1,0,false]);
  for (const [name,value] of [['P',prime],['PPlusOne',prime+1n]]) add('Limbs'+name,[1,4,limbs(value)],[1,0,false]);
  point('MaximumPointPayload',Buffer.alloc(480),false);
  add('PointPayloadOverflow',[1,0,Buffer.alloc(481)],[1,2,6]);
  add('UnknownOperation',[1,5,key],[1,1,1]);
  add('Version',[2,0,key],[1,2,3]);
  add('PointArity',[1,0],[1,2,3]);
  add('ArithmeticArity',[1,1,key],[1,2,3]);
  add('LimbArity',[1,4,[],0],[1,2,3]);
  const frame=encode([1,0,key]); assert.equal(frame.length,70);
  for(let cut=0;cut<frame.length;cut++)raw('Truncated'+cut,frame.subarray(0,cut),[1,2,2]);
  raw('Trailing',Buffer.concat([frame,Buffer.from([0])]),[1,2,8]);
  raw('NoncanonicalVersion',[0x83,0x18,1,...frame.subarray(2)],[1,2,5]);
  raw('IndefiniteArray',[0x9f,...frame.subarray(1),0xff],[1,2,4]);
  raw('ArrayLimit',[0x85],[1,2,6]);
  raw('WrongRootType',[0x40],[1,2,3]);
  raw('FrameMaximum',Buffer.alloc(512),[1,2,3]);
  raw('FrameOverflow',Buffer.alloc(513),[1,2,6]);
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
  assert.equal(rows.length, CORPUS_CASES);
  return rows;
}
