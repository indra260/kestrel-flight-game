// Deterministic randomness: a splitmix-style generator for gameplay rolls,
// plus an integer cell hash so the countryside (field colours, tree spots,
// farmsteads) is the same on every visit and in every screenshot, with no
// seed state to carry around.

/** A seeded generator: same seed, same sequence, every time. */
export function createRandom(seed) {
  let state = (seed | 0) || 0x9e3779b9;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state ^ (state >>> 15);
    t = Math.imul(t, 0x85ebca6b);
    t ^= t >>> 13;
    t = Math.imul(t, 0xc2b2ae35);
    t ^= t >>> 16;
    return (t >>> 0) / 4294967296;
  };
}

/** Random float in [min, max) drawn from a createRandom generator. */
export function randRange(random, min, max) {
  return min + random() * (max - min);
}

/**
 * A stable 0..1 hash of an integer grid cell (used for field patterns and
 * landmark scatter). Pure integer maths, so it agrees on every machine.
 */
export function cellHash(cellX, cellZ) {
  let n = (cellX * 374761393 + cellZ * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 0..1 ramp: 0 at edge0, 1 at edge1, eased in between. */
export function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest signed difference between two headings, in radians. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
