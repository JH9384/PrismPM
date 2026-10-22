// Private retention framing; SessionJournalRetention owns all admission.
// The largest request has 274,722 CBOR nodes (64 roots ×4096 references).
// This profile is separate from the unchanged DK-20 effect codec.
import {bytesCopy} from './identity.mjs';

export const RETENTION_FRAME_MAXIMUM = 64 * 1024 * 1024;
const MAXIMUM_NODES = 275000;
const MAXIMUM_DEPTH = 8;
const MAXIMUM_ITEMS = 4096;
const MAXIMUM_TEXT = 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const bad = () => new Error('invalid-retention-wire');

export function decodeRetentionWire(value) {
  const bytes = bytesCopy(value, RETENTION_FRAME_MAXIMUM);
  let at = 0, remaining = MAXIMUM_NODES;
  function octet() { if (at >= bytes.length) throw bad(); return bytes[at++]; }
  function argument(additional) {
    if (additional < 24) return additional;
    const widths = {24: 1, 25: 2, 26: 4};
    const width = widths[additional];
    if (width === undefined || width > bytes.length - at) throw bad();
    let result = 0;
    for (let i = 0; i < width; i++) result = result * 256 + octet();
    if (result < ({24: 24, 25: 256, 26: 65536})[additional]) throw bad();
    return result;
  }
  function item(depth) {
    if (depth > MAXIMUM_DEPTH || remaining-- <= 0) throw bad();
    const initial = octet(), major = initial >>> 5, additional = initial & 31;
    if (initial === 244) return false;
    if (initial === 245) return true;
    if (![0, 2, 3, 4].includes(major)) throw bad();
    const count = argument(additional);
    if (major === 0) return count;
    if (major === 4) {
      if (count > MAXIMUM_ITEMS || count > remaining || count > bytes.length - at) throw bad();
      return Array.from({length: count}, () => item(depth + 1));
    }
    if (count > bytes.length - at || major === 2 && count > 32 || major === 3 && count > MAXIMUM_TEXT) throw bad();
    const payload = bytes.slice(at, at + count); at += count;
    if (major === 2) return payload;
    try { return decoder.decode(payload); } catch { throw bad(); }
  }
  const result = item(0);
  if (at !== bytes.length) throw bad();
  return result;
}

export function encodeRetentionWire(value) {
  const chunks = [];
  let length = 0, remaining = MAXIMUM_NODES;
  function append(bytes) {
    if (bytes.length > RETENTION_FRAME_MAXIMUM - length) throw bad();
    length += bytes.length; chunks.push(bytes);
  }
  function head(major, number) {
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) throw bad();
    if (number < 24) return append(Uint8Array.of(major * 32 + number));
    const width = number <= 255 ? 1 : number <= 65535 ? 2 : 4;
    const bytes = new Uint8Array(1 + width);
    bytes[0] = major * 32 + ({1: 24, 2: 25, 4: 26})[width];
    for (let i = width; i > 0; i--) { bytes[i] = number % 256; number = Math.floor(number / 256); }
    append(bytes);
  }
  function item(item, depth) {
    if (depth > MAXIMUM_DEPTH || remaining-- <= 0) throw bad();
    if (typeof item === 'number') return head(0, item);
    if (typeof item === 'boolean') return append(Uint8Array.of(item ? 245 : 244));
    if (typeof item === 'string') {
      if (item.length > MAXIMUM_TEXT || !item.isWellFormed()) throw bad();
      const text = encoder.encode(item);
      if (text.length > MAXIMUM_TEXT) throw bad();
      head(3, text.length); return append(text);
    }
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) throw bad();
      const descriptors = Object.getOwnPropertyDescriptors(item), count = descriptors.length?.value;
      if (!Number.isInteger(count) || count < 0 || count > MAXIMUM_ITEMS || count > remaining
        || Reflect.ownKeys(descriptors).length !== count + 1) throw bad();
      head(4, count);
      for (let index = 0; index < count; index++) {
        if (!descriptors[index] || !('value' in descriptors[index])) throw bad();
        visit(descriptors[index].value, depth + 1);
      }
      return;
    }
    const bytes = bytesCopy(item, 32);
    head(2, bytes.length); append(bytes);
  }
  const visit = item;
  visit(value, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
