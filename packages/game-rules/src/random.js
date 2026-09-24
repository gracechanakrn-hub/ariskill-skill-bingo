// Random sources. Production uses cryptographically secure integers; tests use a seeded generator.
import { randomInt } from 'node:crypto';

/** Unbiased secure integer in [0, n). */
export function secureRng() { return { int: (n) => { if (n <= 0) throw new RangeError('n must be > 0'); return randomInt(n); }, kind: 'secure' }; }

/** Deterministic mulberry32 generator for seeded fixtures and tests (NOT for production draws). */
export function seededRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { int: (n) => { if (n <= 0) throw new RangeError('n must be > 0'); return Math.floor(next() * n); }, float: next, kind: 'seeded', seed: a };
}

/** cyrb53-style 53-bit string hash, isomorphic (browser + node). */
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0); // 53-bit safe integer
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = rng.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Uniform pick from a non-empty list. */
export function pickOne(items, rng) { if (!items.length) throw new RangeError('empty'); return items[rng.int(items.length)]; }
