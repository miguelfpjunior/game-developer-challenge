import { Container, Graphics, type Renderer, Sprite, type Texture } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, ISLANDS, pointHitsAnyIsland, TILE } from './arena';
import type { GameTextures } from './assets';
import { createRng, TAU } from './math';

/**
 * Purely decorative life: sea colour variation, fish, extra island vegetation and birds.
 * Nothing here touches the simulation. Layout uses a fixed seed and motion only advances
 * with the render clock, so screenshots under the manual test clock stay deterministic.
 */

const PALMS = [70, 71, 72];
const SPROUTS = [87, 88];
const MOSSY_ROCKS = [65, 66, 67];
/** Tiles the asset loader must include for the extra vegetation. */
export const VEGETATION_TILES: readonly number[] = [...PALMS, ...SPROUTS, ...MOSSY_ROCKS];

interface Fish {
  node: Sprite;
  x: number;
  y: number;
  angle: number;
  speed: number;
  phase: number;
  turn: number;
}

interface Bird {
  root: Container;
  body: Sprite;
  shadow: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  scale: number;
}

export class Ambience {
  /** Under the islands, above the patches. */
  readonly fishLayer = new Container();
  /** Above everything in the arena except health bars. */
  readonly birdLayer = new Container();
  private readonly fish: Fish[] = [];
  private readonly birds: Bird[] = [];
  private readonly rng = createRng(20261125);
  private readonly fishTex: Texture;
  private readonly gullTex: Texture;
  private readonly gullShadowTex: Texture;

  constructor(renderer: Renderer) {
    // Shapes are drawn once into textures, so fish and birds render as batched sprites.
    const toTexture = (g: Graphics): Texture => {
      const t = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
      g.destroy();
      return t;
    };
    this.fishTex = toTexture(
      new Graphics().ellipse(0, 0, 4, 9).fill({ color: 0x08324f, alpha: 0.45 }).poly([0, 8, -5, 15, 5, 15]).fill({ color: 0x08324f, alpha: 0.4 }),
    );
    const gull = new Graphics();
    drawGull(gull, 0xffffff, 0.95);
    this.gullTex = toTexture(gull);
    const shadow = new Graphics();
    drawGull(shadow, 0x062a40, 0.18);
    this.gullShadowTex = toTexture(shadow);
    this.buildFish();
    this.buildBirds();
  }

  /** Extra vegetation drawn into the (cached) island layer. */
  static addVegetation(layer: Container, textures: GameTextures): void {
    const rng = createRng(77);
    const pick = (arr: number[]) => arr[Math.floor(rng() * arr.length)]!;
    for (const island of ISLANDS) {
      const c = island.collider;
      const grassy = island.tiles.length > 9;
      const count = grassy ? 16 : 9;
      const margin = 18;
      for (let i = 0; i < count; i++) {
        const r = rng();
        const tile = r < 0.3 ? pick(PALMS) : r < 0.85 ? pick(SPROUTS) : pick(MOSSY_ROCKS);
        const s = new Sprite(textures.tile(tile));
        s.anchor.set(0.5);
        s.position.set(c.x + margin + rng() * (c.w - margin * 2), c.y + margin + rng() * (c.h - margin * 2));
        const base = tile === 70 || tile === 71 || tile === 72 ? 0.55 + rng() * 0.45 : 0.6 + rng() * 0.6;
        s.width = TILE * base;
        s.height = TILE * base;
        s.rotation = rng() * TAU;
        layer.addChild(s);
      }
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const f of this.fish) {
      f.phase += dt * 8;
      f.angle += f.turn * dt;
      const nx = f.x + Math.sin(f.angle) * f.speed * dt;
      const ny = f.y - Math.cos(f.angle) * f.speed * dt;
      // Turn around at islands and arena edges.
      if (pointHitsAnyIsland({ x: nx, y: ny }) || nx < 20 || ny < 20 || nx > ARENA_WIDTH - 20 || ny > ARENA_HEIGHT - 20) {
        f.angle += Math.PI * (0.6 + this.rng() * 0.4);
      } else {
        f.x = nx;
        f.y = ny;
      }
      if (this.rng() < dt * 0.5) f.turn = (this.rng() - 0.5) * 1.2;
      f.node.position.set(f.x, f.y);
      f.node.rotation = f.angle + Math.sin(f.phase) * 0.15;
    }
    for (const b of this.birds) {
      b.phase += dt * 9;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -120 || b.x > ARENA_WIDTH + 120 || b.y < -120 || b.y > ARENA_HEIGHT + 120) this.respawnBird(b);
      b.root.position.set(b.x, b.y);
      // Wing flap: squash the wings vertically.
      b.body.scale.set(b.scale, b.scale * (0.55 + 0.45 * Math.abs(Math.sin(b.phase))));
    }
  }

  destroy(): void {
    this.fish.length = 0;
    this.birds.length = 0;
    this.fishTex.destroy(true);
    this.gullTex.destroy(true);
    this.gullShadowTex.destroy(true);
    this.fishLayer.destroy({ children: true });
    this.birdLayer.destroy({ children: true });
  }

  // ------------------------------------------------------------------

  /** Static sea colour variation (deep and shallow water). Meant to be baked into a texture. */
  static buildSea(): Graphics {
    const rng = createRng(4242);
    // Soft edges without a blur filter: stack growing shapes with low alpha each.
    const g = new Graphics();
    const STEPS = 6;
    const softRect = (x: number, y: number, w: number, h: number, r: number, spread: number, color: number, alpha: number) => {
      for (let k = STEPS; k >= 1; k--) {
        const grow = (spread * k) / STEPS;
        g.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, r + grow).fill({ color, alpha: alpha / STEPS });
      }
    };
    const softEllipse = (x: number, y: number, rx: number, ry: number, color: number, alpha: number) => {
      for (let k = STEPS; k >= 1; k--) {
        const f = 0.4 + (0.6 * k) / STEPS;
        g.ellipse(x, y, rx * f, ry * f).fill({ color, alpha: alpha / STEPS });
      }
    };
    // Shallow, lighter water around every island.
    for (const island of ISLANDS) {
      const c = island.collider;
      softRect(c.x, c.y, c.w, c.h, 40, 70, 0xd8fcff, 0.75);
    }
    // Deep, darker patches in open water.
    for (let i = 0; i < 9; i++) {
      const x = 80 + rng() * (ARENA_WIDTH - 160);
      const y = 80 + rng() * (ARENA_HEIGHT - 160);
      if (pointHitsAnyIsland({ x, y })) continue;
      softEllipse(x, y, 110 + rng() * 120, 60 + rng() * 80, 0x0a4f86, 0.32);
    }
    // A few lighter sandbars.
    for (let i = 0; i < 5; i++) {
      const x = 80 + rng() * (ARENA_WIDTH - 160);
      const y = 80 + rng() * (ARENA_HEIGHT - 160);
      softEllipse(x, y, 60 + rng() * 60, 30 + rng() * 30, 0xc4f6ff, 0.3);
    }
    return g;
  }

  private buildFish(): void {
    const schools = 5;
    for (let s = 0; s < schools; s++) {
      let cx: number;
      let cy: number;
      do {
        cx = 100 + this.rng() * (ARENA_WIDTH - 200);
        cy = 100 + this.rng() * (ARENA_HEIGHT - 200);
      } while (pointHitsAnyIsland({ x: cx, y: cy }));
      const angle = this.rng() * TAU;
      const size = 3 + Math.floor(this.rng() * 3);
      for (let i = 0; i < size; i++) {
        const node = new Sprite(this.fishTex);
        node.anchor.set(0.5, 0.3);
        const fish: Fish = {
          node,
          x: cx + (this.rng() - 0.5) * 40,
          y: cy + (this.rng() - 0.5) * 40,
          angle: angle + (this.rng() - 0.5) * 0.4,
          speed: 22 + this.rng() * 14,
          phase: this.rng() * TAU,
          turn: (this.rng() - 0.5) * 0.6,
        };
        node.position.set(fish.x, fish.y);
        this.fishLayer.addChild(node);
        this.fish.push(fish);
      }
    }
  }

  private buildBirds(): void {
    for (let i = 0; i < 4; i++) {
      const root = new Container();
      const shadow = new Sprite(this.gullShadowTex);
      shadow.anchor.set(0.5);
      shadow.position.set(26, 38);
      const body = new Sprite(this.gullTex);
      body.anchor.set(0.5);
      root.addChild(shadow, body);
      this.birdLayer.addChild(root);
      const bird: Bird = { root, body, shadow, x: 0, y: 0, vx: 0, vy: 0, phase: this.rng() * TAU, scale: 1 };
      this.respawnBird(bird, true);
      this.birds.push(bird);
    }
  }

  private respawnBird(b: Bird, anywhere = false): void {
    const speed = 55 + this.rng() * 35;
    const dir = this.rng() * TAU;
    b.vx = Math.cos(dir) * speed;
    b.vy = Math.sin(dir) * speed;
    if (anywhere) {
      b.x = this.rng() * ARENA_WIDTH;
      b.y = this.rng() * ARENA_HEIGHT;
    } else {
      // Enter from the edge opposite to the flight direction.
      b.x = b.vx > 0 ? -100 : ARENA_WIDTH + 100;
      b.y = this.rng() * ARENA_HEIGHT;
    }
    b.scale = 1.4 + this.rng() * 0.6;
    b.root.rotation = Math.atan2(b.vy, b.vx) + Math.PI / 2;
    b.shadow.scale.set(b.scale);
  }
}

/** Top-down seagull: two curved wings and a small body, pointing up (−y). */
function drawGull(g: Graphics, color: number, alpha: number): void {
  g.moveTo(0, 0)
    .quadraticCurveTo(-10, -8, -22, -2)
    .quadraticCurveTo(-11, -3, 0, 4)
    .quadraticCurveTo(11, -3, 22, -2)
    .quadraticCurveTo(10, -8, 0, 0)
    .fill({ color, alpha });
  g.ellipse(0, 0, 2.6, 7).fill({ color, alpha });
  if (color === 0xffffff) {
    // Grey wing tips.
    g.circle(-20, -2, 2).fill({ color: 0x55606a, alpha: 0.9 });
    g.circle(20, -2, 2).fill({ color: 0x55606a, alpha: 0.9 });
  }
}
