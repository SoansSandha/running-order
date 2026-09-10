/**
 * Deterministic shuffle.
 *
 * Pure module: no network, no browser APIs. See docs design §6.
 *
 * Unlike Spotify's own shuffle, this writes a permanent order — so it is
 * seeded, making a given shuffle reproducible and shareable rather than a
 * one-off the user can never recover.
 */

/** xmur3: fold an arbitrary string into a 32-bit seed. */
function hashSeed(text) {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** mulberry32: small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates driven by a seeded PRNG. Returns a new array. */
export function seededShuffle(items, seed = '') {
  const random = mulberry32(hashSeed(String(seed)))
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
