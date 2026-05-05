/**
 * Mulberry32 — deterministic seeded PRNG.
 *
 * Same seed always yields the same sequence. Used wherever we need
 * reproducible randomness (sample data generation, jitter on synthetic
 * datasets, deterministic test fixtures).
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
