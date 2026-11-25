export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

/** Heading convention: angle 0 points up (−y), positive angles turn clockwise. */
export function forward(angle: number): Vec2 {
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

/** Unit vector pointing to the ship's right (starboard). */
export function rightOf(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
