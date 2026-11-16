import { TestSetupError } from './errors.mjs';

function seedOf(seed) {
  if (typeof seed === 'number' && Number.isInteger(seed)) return seed >>> 0;
  if (typeof seed === 'string') {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  throw new TestSetupError('a random seed is an integer or a string', { check: 'testing.random' });
}

/** A seeded generator (mulberry32): the same seed gives the same sequence on every platform. */
export function createRandom({ seed = 0 } = {}) {
  let state = seedOf(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (n) => Array.from({ length: n }, () => Math.floor(next() * 256).toString(16).padStart(2, '0')).join('');
  return Object.freeze({
    /** A float in [0, 1). */
    next,
    /** An integer in [0, max). */
    int(max) {
      if (!Number.isInteger(max) || max <= 0) throw new TestSetupError(`int takes a positive integer, not ${String(max)}`, { check: 'testing.random' });
      return Math.floor(next() * max);
    },
    bytes: (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)),
    /** Fill a typed array in place, as `crypto.getRandomValues` does. */
    getRandomValues(array) {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < view.length; i++) view[i] = Math.floor(next() * 256);
      return array;
    },
    /** A version 4 UUID built from the sequence. */
    uuid() {
      const h = hex(16).split('');
      h[12] = '4';
      h[16] = '89ab'[Number.parseInt(h[16], 16) % 4];
      const s = h.join('');
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
    },
  });
}
