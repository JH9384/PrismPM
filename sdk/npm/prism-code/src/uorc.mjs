/**
 * Holo v5 container: a self-contained raw UORC archive of ordered objects
 * (ADR-017; UOR-Foundation/compression `Uorc.Codec.Archive`, what
 * `uorc::archive::raw_objects` writes). The Rust twin is
 * `crates/prismpm/src/holo/v5.rs`; both are held to the same bytes.
 *
 *   "UORC" 02 01 00 00 uleb(count) uleb(length)* uleb(bodyLength) body seal[32]
 *
 * `seal` is UORC-SHA256-CHAIN-v1 over every byte before it. Every identity is
 * a κ-label: `sha256:` and the lowercase hex SHA-256 of the bytes it names.
 */
import { DigestMismatchError, fail } from './errors.mjs';
import { sha256HexSync } from './sha256.mjs';

export const MAGIC = Uint8Array.of(0x55, 0x4f, 0x52, 0x43, 0x02, 0x01);
export const SEAL_LENGTH = 32;
export const KAPPA_LENGTH = 71;
/** The decode budget every reader applies to an application holo. */
export const APPLICATION_BUDGET = Object.freeze({ objects: 16, bytes: 2 ** 30 });

const TAG = new TextEncoder().encode('UORC-SHA256-CHAIN-v1\0');

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const sha256 = (parts) => fromHex(sha256HexSync(concat(parts)));

/** The κ-label of `bytes`. */
export function kappa(bytes) {
  return `sha256:${sha256HexSync(bytes)}`;
}

/** Whether `label` is a well-formed κ-label. */
export function isKappa(label) {
  return typeof label === 'string' && /^sha256:[0-9a-f]{64}$/.test(label);
}

/** Whether `bytes` start like a UORC archive. */
export function isUorc(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x55 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x43;
}

/** UORC-SHA256-CHAIN-v1 of `preimage`, as bytes. */
export function chain(preimage) {
  let c = sha256([TAG, Uint8Array.of(0)]);
  const whole = preimage.length - (preimage.length % 64);
  for (let at = 0; at < whole; at += 64) c = sha256([TAG, Uint8Array.of(1), c, preimage.subarray(at, at + 64)]);
  const tail = preimage.subarray(whole);
  return sha256([TAG, Uint8Array.of(2), c, Uint8Array.of(tail.length), tail]);
}

function uleb(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return Uint8Array.from(out);
}

function readUleb(bytes, at) {
  let value = 0;
  let scale = 1;
  const start = at;
  for (;;) {
    if (at >= bytes.length || at - start > 7) return null;
    const byte = bytes[at];
    at += 1;
    value += (byte & 0x7f) * scale;
    scale *= 0x80;
    if (byte < 0x80) {
      if (byte === 0 && at - start > 1) return null; // not the shortest form
      if (!Number.isSafeInteger(value)) return null;
      return [value, at];
    }
  }
}

/** The self-contained raw UORC archive of `objects`, in order. */
export function writeObjects(objects) {
  const header = [MAGIC, Uint8Array.of(0, 0), uleb(objects.length)];
  for (const object of objects) header.push(uleb(object.length));
  header.push(uleb(objects.reduce((n, o) => n + o.length, 0)));
  const preimage = concat([...header, ...objects]);
  return concat([preimage, chain(preimage)]);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The ordered objects of a raw self-contained UORC archive and whether its
 * seal matches. The framing and the budget are enforced; the seal is reported,
 * so `inspect` can still look at a damaged holo.
 */
export function layout(bytes, budget = APPLICATION_BUDGET) {
  if (!equal(bytes.subarray(0, 6), MAGIC)) fail('archive.magic', 'a holo v5 file is a UORC archive (format 2, profile 1)');
  if (bytes.length < 8 + SEAL_LENGTH) fail('archive.bounds', 'UORC archive is truncated');
  const preimage = bytes.subarray(0, bytes.length - SEAL_LENGTH);
  const seal = bytes.subarray(bytes.length - SEAL_LENGTH);
  const sealed = equal(chain(preimage), seal);
  if (preimage[6] !== 0 || preimage[7] !== 0) fail('archive.bounds', 'a holo is a self-contained archive whose objects are stored raw');
  let read = readUleb(preimage, 8);
  if (!read) fail('archive.bounds', 'object count is not a ULEB128');
  const [count] = read;
  let at = read[1];
  if (count === 0 || count > budget.objects) fail('archive.bounds', `archive declares ${count} objects; a holo holds 1 to ${budget.objects}`);
  const lengths = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    read = readUleb(preimage, at);
    if (!read) fail('archive.bounds', 'object length is not a ULEB128');
    total += read[0];
    if (total > budget.bytes) fail('archive.bounds', 'archive exceeds the decode budget');
    lengths.push(read[0]);
    at = read[1];
  }
  read = readUleb(preimage, at);
  if (!read) fail('archive.bounds', 'body length is not a ULEB128');
  const [bodyLength, start] = read;
  if (bodyLength !== total || preimage.length - start !== total) {
    fail('archive.bounds', 'body length disagrees with the objects or the archive has trailing bytes');
  }
  const objects = [];
  let offset = start;
  for (const length of lengths) {
    objects.push({ offset, length, bytes: preimage.subarray(offset, offset + length) });
    offset += length;
  }
  return { objects, sealed, seal, preimage };
}

/** The ordered objects of a UORC archive whose seal matches; anything else throws. */
export function readObjects(bytes, budget = APPLICATION_BUDGET) {
  if (equal(bytes.subarray(0, 6), MAGIC) && bytes.length >= SEAL_LENGTH) {
    const preimage = bytes.subarray(0, bytes.length - SEAL_LENGTH);
    if (!equal(chain(preimage), bytes.subarray(bytes.length - SEAL_LENGTH))) {
      throw new DigestMismatchError('integrity failure: the holo was altered: its UORC-SHA256-CHAIN-v1 seal does not match', { check: 'holo.integrity' });
    }
  }
  return layout(bytes, budget).objects.map((object) => object.bytes);
}
