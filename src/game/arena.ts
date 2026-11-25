import type { Vec2 } from './math';

/** Logical world size. The canvas scales this to the screen, preserving aspect ratio. */
export const TILE = 64;
export const ARENA_COLS = 25;
export const ARENA_ROWS = 15;
export const ARENA_WIDTH = TILE * ARENA_COLS; // 1600
export const ARENA_HEIGHT = TILE * ARENA_ROWS; // 960

/** Tile ids from assets/png/*\/tiles (row-major index into the 16×6 tile sheet, 1-based). */
export const WATER_TILE = 73;
const SAND_ISLAND = [
  [1, 2, 3],
  [17, 18, 19],
  [33, 34, 35],
];
const GRASS_ISLAND = [
  [6, 7, 8, 9],
  [22, 23, 24, 25],
  [38, 39, 40, 41],
  [54, 55, 56, 57],
];
const PALMS = [70, 71, 72];
const ROCKS = [49, 50, 51];

/** Rounded rectangle collider (world px). */
export interface Collider {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface TilePlacement {
  tile: number;
  x: number;
  y: number;
}

export interface Island {
  tiles: TilePlacement[];
  decorations: TilePlacement[];
  collider: Collider;
}

function buildIsland(
  layout: number[][],
  col: number,
  row: number,
  inset: number,
  decorations: Array<{ tile: number; dx: number; dy: number }>,
): Island {
  const tiles: TilePlacement[] = [];
  layout.forEach((line, r) =>
    line.forEach((tile, c) => tiles.push({ tile, x: (col + c) * TILE, y: (row + r) * TILE })),
  );
  const w = layout[0]!.length * TILE;
  const h = layout.length * TILE;
  return {
    tiles,
    decorations: decorations.map((d) => ({ tile: d.tile, x: col * TILE + d.dx, y: row * TILE + d.dy })),
    collider: { x: col * TILE + inset, y: row * TILE + inset, w: w - inset * 2, h: h - inset * 2, r: 36 },
  };
}

export const ISLANDS: readonly Island[] = [
  buildIsland(SAND_ISLAND, 4, 2, 10, [{ tile: PALMS[1]!, dx: 64, dy: 56 }]),
  buildIsland(GRASS_ISLAND, 10, 5, 6, [
    { tile: PALMS[0]!, dx: 40, dy: 40 },
    { tile: ROCKS[2]!, dx: 150, dy: 140 },
  ]),
  buildIsland(SAND_ISLAND, 18, 2, 10, [{ tile: ROCKS[1]!, dx: 64, dy: 64 }]),
  buildIsland(SAND_ISLAND, 5, 10, 10, [{ tile: PALMS[2]!, dx: 70, dy: 60 }]),
  buildIsland(GRASS_ISLAND, 17, 9, 6, [
    { tile: PALMS[1]!, dx: 130, dy: 60 },
    { tile: ROCKS[0]!, dx: 50, dy: 150 },
  ]),
];

export const PLAYER_START: Vec2 = { x: 160, y: 480 };

/** Signed-ish distance from point to the collider's core rect (0 inside the core). */
function distToCore(c: Collider, p: Vec2): { dx: number; dy: number; d: number } {
  const cx = Math.max(c.x + c.r, Math.min(p.x, c.x + c.w - c.r));
  const cy = Math.max(c.y + c.r, Math.min(p.y, c.y + c.h - c.r));
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { dx, dy, d: Math.hypot(dx, dy) };
}

export function pointInCollider(c: Collider, p: Vec2): boolean {
  return distToCore(c, p).d <= c.r;
}

/**
 * Push a circle out of a collider. Returns true if a correction happened.
 * Mutates `p` in place.
 */
export function resolveCircleVsCollider(c: Collider, p: Vec2, radius: number): boolean {
  const { dx, dy, d } = distToCore(c, p);
  const min = c.r + radius;
  if (d >= min) return false;
  if (d < 1e-6) {
    // Center inside the core: push out along the shortest axis.
    const left = p.x - c.x;
    const right = c.x + c.w - p.x;
    const top = p.y - c.y;
    const bottom = c.y + c.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = c.x - radius;
    else if (m === right) p.x = c.x + c.w + radius;
    else if (m === top) p.y = c.y - radius;
    else p.y = c.y + c.h + radius;
    return true;
  }
  const push = (min - d) / d;
  p.x += dx * push;
  p.y += dy * push;
  return true;
}

export function circleHitsAnyIsland(p: Vec2, radius: number): boolean {
  return ISLANDS.some((i) => distToCore(i.collider, p).d < i.collider.r + radius);
}

export function pointHitsAnyIsland(p: Vec2): boolean {
  return ISLANDS.some((i) => pointInCollider(i.collider, p));
}

export function insideArena(p: Vec2, margin = 0): boolean {
  return p.x >= margin && p.y >= margin && p.x <= ARENA_WIDTH - margin && p.y <= ARENA_HEIGHT - margin;
}
