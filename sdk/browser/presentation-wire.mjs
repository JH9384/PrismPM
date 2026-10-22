import {bytesCopy, bytesLength} from './identity.mjs';

export const PRESENTATION_MAXIMUM = 67108864;
export class PresentationError extends Error {
  constructor(code) { super(code); this.name = 'PresentationError'; this.code = code; }
}
const fail = code => { throw new PresentationError(code); };
const need = (condition, code = 'shape') => { if (!condition) fail(code); };
const integer = (value, low = 0, high = 4294967295) =>
  Number.isInteger(value) && value >= low && value <= high;
const label = value => integer(value, 0, 255);
const array = (value, length) => Array.isArray(value) && value.length === length;
const textBytes = value => {
  need(typeof value === 'string', 'shape');
  // TextEncoder replaces unpaired surrogates; reject instead of normalizing.
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 128) count++;
    else if (unit < 2048) count += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      need(i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff, 'utf8');
      i++; count += 4;
    } else { need(unit < 0xdc00 || unit > 0xdfff, 'utf8'); count += 3; }
    need(count <= PRESENTATION_MAXIMUM, 'limit');
  }
  return count;
};
const freeze = value => { if (Array.isArray(value)) { value.forEach(freeze); Object.freeze(value); } return value; };

function decode(bytes, maximum) {
  need(integer(maximum, 1, PRESENTATION_MAXIMUM), 'limit');
  let length, input;
  try { length = bytesLength(bytes, Number.MAX_SAFE_INTEGER); } catch { fail('bytes'); }
  need(length <= maximum, 'limit');
  try { input = bytesCopy(bytes, maximum); } catch { fail('bytes'); }
  need(input.length <= maximum, 'limit');
  let cursor = 0, fuel = 20000;
  const utf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  function read(depth) {
    need(depth <= 8 && --fuel >= 0, 'limit');
    need(cursor < input.length, 'truncated');
    const head = input[cursor++], major = head >> 5, minor = head & 31;
    if (major === 7) {
      if (minor === 20) return false;
      if (minor === 21) return true;
      fail('unsupported');
    }
    need([0, 3, 4].includes(major), 'unsupported');
    let size = minor;
    if (minor >= 24) {
      const width = {24: 1, 25: 2, 26: 4}[minor]; need(width, 'unsupported');
      need(cursor + width <= input.length, 'truncated'); size = 0;
      for (let i = 0; i < width; i++) size = size * 256 + input[cursor++];
      need(size >= ({1: 24, 2: 256, 4: 65536}[width]), 'canonical');
    }
    if (major === 0) return size;
    if (major === 3) {
      need(cursor + size <= input.length, 'truncated');
      let value; try { value = utf8.decode(input.subarray(cursor, cursor + size)); } catch { fail('utf8'); }
      cursor += size; return value;
    }
    need(size <= 4096 && size <= input.length - cursor, 'limit');
    const values = []; for (let i = 0; i < size; i++) values.push(read(depth + 1)); return values;
  }
  const value = read(0); need(cursor === input.length, 'trailing'); return value;
}

// SDK-private composition only. Consumers must validate their complete closed
// frame after this bounded canonical decoder; decoded arrays grant no authority.
export function decodePresentationWireValue(bytes, maximum = PRESENTATION_MAXIMUM) {
  return decode(bytes, maximum);
}

export function validatePresentation(frame) {
  need(array(frame, 7) && frame[0] === 1 && integer(frame[1]) && integer(frame[2], 0, 3)
    && integer(frame[3], 0, 256) && integer(frame[4], 0, 2) && integer(frame[5], 0, 256)
    && Array.isArray(frame[6]) && frame[6].length <= 256);
  const nodes = frame[6], depths = [0], forms = [false], ids = new Set(), defaults = new Set();
  let actions = 0, options = 0, cells = 0;
  const fields = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]; need(array(node, 2) && integer(node[0], 0, i) && Array.isArray(node[1]));
    const [parent, value] = node, tag = value[0]; need(integer(tag, 0, 11), 'unsupported');
    need(parent === 0 || [0, 1, 2].includes(nodes[parent - 1][1][0]), 'parent');
    depths.push(depths[parent] + 1); need(depths[i + 1] <= 16, 'limit');
    need(tag !== 2 || !forms[parent], 'parent'); forms.push(forms[parent] || tag === 2);
    if ([5, 6, 7, 8, 10, 11].includes(tag)) need(parent > 0 && nodes[parent - 1][1][0] === 2, 'parent');
    if ([0, 1, 2].includes(tag)) need(array(value, 2) && label(value[1]));
    else if (tag === 3) need(array(value, 3) && integer(value[1], 1, 6) && label(value[2]));
    else if (tag === 4) { need(array(value, 2)); textBytes(value[1]); }
    else if (tag === 5 || tag === 6) {
      need(array(value, 7) && label(value[1]) && typeof value[2] === 'boolean' && typeof value[3] === 'boolean'
        && integer(value[4], 1, PRESENTATION_MAXIMUM) && integer(value[6]));
      need(textBytes(value[5]) <= value[4], 'limit');
      need(!value[2] || frame[2] === 0, 'lifecycle');
    } else if (tag === 7 || tag === 11) {
      need(array(value, 7) && label(value[1]) && typeof value[2] === 'boolean' && typeof value[3] === 'boolean'
        && integer(value[4]) && Array.isArray(value[5]) && integer(value[6]));
      options += value[5].length; need(options <= 256, 'limit'); let previous = 0, selected = value[4] === 0;
      const optionIds = new Set();
      for (const option of value[5]) {
        need(array(option, 2) && integer(option[0], tag === 7 ? previous + 1 : 1), 'binding');
        if (tag === 7) need(label(option[1]), 'binding');
        else {
          need(!optionIds.has(option[0]), 'binding');
          const size = textBytes(option[1]); need(size > 0 && size <= 4096, 'limit');
        }
        optionIds.add(option[0]); previous = option[0]; selected ||= value[4] === option[0];
      }
      need(selected, 'binding'); need(!value[2] || frame[2] === 0, 'lifecycle');
    } else if (tag === 8) {
      need(array(value, 6) && label(value[1]) && integer(value[2], 1) && typeof value[3] === 'boolean'
        && typeof value[4] === 'boolean' && Array.isArray(value[5]) && value[5].length <= 16);
      need(++actions <= 64, 'limit'); need(!ids.has(value[2]), 'binding'); ids.add(value[2]);
      if (value[4]) { need(!defaults.has(parent), 'binding'); defaults.add(parent); }
      need(!value[3] || frame[2] === 0, 'lifecycle'); fields.push([parent, value]);
    } else if (tag === 9) {
      need(array(value, 4) && label(value[1]) && Array.isArray(value[2]) && integer(value[2].length, 1, 16)
        && value[2].every(label) && Array.isArray(value[3]));
      for (const row of value[3]) { need(array(row, value[2].length)); cells += row.length; need(cells <= 4096, 'limit'); row.forEach(textBytes); }
    } else if (tag === 10) {
      need(array(value, 6) && label(value[1]) && typeof value[2] === 'boolean' && typeof value[3] === 'boolean'
        && integer(value[4], 1, PRESENTATION_MAXIMUM) && integer(value[5]));
      need(!value[2] || frame[2] === 0, 'lifecycle');
    }
  }
  for (const [parent, value] of fields) {
    let previous = 0;
    for (const id of value[5]) {
      need(integer(id, previous + 1, nodes.length), 'binding'); previous = id;
      const field = nodes[id - 1]; need(field[0] === parent && [5, 6, 7, 10, 11].includes(field[1][0]), 'binding');
      need(!value[3] || field[1][2], 'binding');
    }
  }
  need(frame[5] <= nodes.length && (frame[2] !== 3 || frame[5] === 0), 'focus');
  return frame;
}

export function decodePresentation(bytes, maximum = PRESENTATION_MAXIMUM) {
  return freeze(validatePresentation(decode(bytes, maximum)));
}
export function decodeIntent(bytes, maximum = PRESENTATION_MAXIMUM) {
  return freeze(intentShape(decode(bytes, maximum)));
}
function intentShape(intent) {
  need(array(intent, 4) && intent[0] === 1 && integer(intent[1]) && integer(intent[2], 1)
    && Array.isArray(intent[3]) && intent[3].length <= 16);
  let previous = 0;
  for (const field of intent[3]) {
    need(array(field, 2) && integer(field[0], previous + 1, 256), 'binding'); previous = field[0];
    if (typeof field[1] === 'string') textBytes(field[1]); else need(integer(field[1]), 'shape');
  }
  return intent;
}
export function validateIntent(frame, intent) {
  validatePresentation(frame); intentShape(intent);
  need(frame[2] === 0 && frame[1] === intent[1], 'stale');
  const matches = frame[6].filter(node => node[1][0] === 8 && node[1][2] === intent[2]);
  need(matches.length === 1 && matches[0][1][3], 'binding');
  const action = matches[0][1]; need(action[5].length === intent[3].length, 'binding');
  for (let i = 0; i < action[5].length; i++) {
    const [id, value] = intent[3][i]; need(id === action[5][i], 'binding');
    const field = frame[6][id - 1][1]; need(field[2], 'binding');
    if (field[0] === 7 || field[0] === 11) {
      need(integer(value) && (value === 0 || field[5].some(option => option[0] === value)), 'binding');
      need(!field[3] || value !== 0, 'required');
    } else { need(typeof value === 'string' && textBytes(value) <= field[4], 'limit'); need(!field[3] || value.length !== 0, 'required'); }
  }
  return true;
}

// Independent host checks mirror the source-owned binding classification.
// Secret data never turns an unrelated ordinary action into a secret action.
export function presentationRequiresSecret(frame) {
  validatePresentation(frame);
  return frame[6].some(([, value]) => value[0] === 8
    && value[5].some(id => frame[6][id - 1][1][0] === 10));
}
export function intentRequiresSecret(frame, intent) {
  validateIntent(frame, intent);
  const action = frame[6].find(([, value]) => value[0] === 8 && value[2] === intent[2])[1];
  return action[5].some(id => frame[6][id - 1][1][0] === 10);
}

// Both inputs are validated frames, not caller-provided permission claims.
export function progressFits(current, next) {
  validatePresentation(current); validatePresentation(next);
  return (current[2] === 0 || current[2] === 1) && next[2] === 1 && next[1] > current[1];
}

// Private deterministic writer. Precompute complete byte length before allocation.
export function encodeWire(value, maximum = PRESENTATION_MAXIMUM) {
  need(integer(maximum, 1, PRESENTATION_MAXIMUM), 'limit'); let fuel = 20000;
  const headLength = n => n < 24 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5;
  function length(item, depth) {
    need(--fuel >= 0 && depth <= 8, 'limit');
    if (typeof item === 'boolean') return 1;
    if (integer(item)) return headLength(item);
    if (typeof item === 'string') { const n = textBytes(item); return headLength(n) + n; }
    need(Array.isArray(item) && item.length <= 4096, 'shape');
    let total = headLength(item.length);
    for (const entry of item) { total += length(entry, depth + 1); need(total <= maximum, 'limit'); }
    return total;
  }
  const size = length(value, 0); need(size <= maximum, 'limit');
  const output = new Uint8Array(size); let cursor = 0;
  function head(major, n) {
    if (n < 24) output[cursor++] = major * 32 + n;
    else { const width = n < 256 ? 1 : n < 65536 ? 2 : 4; output[cursor++] = major * 32 + ({1: 24, 2: 25, 4: 26}[width]);
      for (let i = width - 1; i >= 0; i--) output[cursor++] = Math.floor(n / 256 ** i) % 256; }
  }
  function write(item) {
    if (typeof item === 'boolean') output[cursor++] = item ? 245 : 244;
    else if (typeof item === 'number') head(0, item);
    else if (typeof item === 'string') { const n = textBytes(item); head(3, n); const result = new TextEncoder().encodeInto(item, output.subarray(cursor)); need(result.written === n && result.read === item.length, 'utf8'); cursor += n; }
    else { head(4, item.length); item.forEach(write); }
  }
  write(value); need(cursor === size, 'shape'); return output;
}
export function encodeIntent(intent, maximum = PRESENTATION_MAXIMUM) {
  return encodeWire(intentShape(intent), maximum);
}
