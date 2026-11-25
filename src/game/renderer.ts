import { Container, Graphics, Rectangle, type Renderer, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { Ambience } from './ambience';
import { ARENA_HEIGHT, ARENA_WIDTH, ISLANDS, TILE, WATER_TILE } from './arena';
import { type GameTextures, SHIP_COLOR } from './assets';
import type { GameEvent, Ship, ShipKind, Simulation } from './simulation';

/**
 * Pixi view of the simulation. Reads simulation state, never mutates it.
 * Owns every display object it creates and frees them in `destroy()`;
 * shared textures are NOT destroyed (they are reused across matches).
 */

const SHIP_SCALE: Record<ShipKind, number> = { player: 0.78, chaser: 0.62, shooter: 0.7 };
const BAR_FRAME_SCALE = 0.5;

interface ShipView {
  root: Container;
  hull: Sprite;
  fire: Sprite;
  bar: Container;
  barFill: Graphics;
  lastStage: number;
  lastRatio: number;
}

interface Effect {
  node: Container;
  age: number;
  duration: number;
  update: (t: number) => void;
}

function damageStage(hp: number, maxHp: number): 0 | 1 | 2 {
  const r = hp / maxHp;
  return r > 0.66 ? 0 : r > 0.33 ? 1 : 2;
}

export class GameRenderer {
  readonly stage = new Container();
  private readonly world = new Container();
  private readonly water: TilingSprite;
  private readonly wreckLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly barLayer = new Container();
  private readonly ships = new Map<number, ShipView>();
  private readonly projectiles = new Map<number, Sprite>();
  private readonly projectilePool: Sprite[] = [];
  private effects: Effect[] = [];
  private readonly tex: GameTextures;
  private shake = 0;
  private time = 0;
  private readonly ambience: Ambience;
  private readonly baked: Texture[] = [];

  constructor(textures: GameTextures, renderer: Renderer) {
    this.tex = textures;
    this.ambience = new Ambience(renderer);
    // The sea covers the whole screen (screen space, behind the world) so there are no
    // letterbox bars; it is scrolled and scaled to stay seamless with the arena.
    this.water = new TilingSprite({ texture: textures.tile(WATER_TILE), width: ARENA_WIDTH, height: ARENA_HEIGHT });
    this.waterTileScale = TILE / textures.tile(WATER_TILE).width;
    this.stage.addChild(this.water, this.world);

    const islandLayer = new Container();
    for (const island of ISLANDS) {
      for (const t of [...island.tiles, ...island.decorations]) {
        const s = new Sprite(textures.tile(t.tile));
        s.position.set(t.x, t.y);
        s.width = TILE;
        s.height = TILE;
        islandLayer.addChild(s);
      }
    }
    Ambience.addVegetation(islandLayer, textures);

    // Static scenery is baked once into arena-sized textures: one quad each per frame,
    // instead of hundreds of translucent shapes and sprites (matters for software GL / mobiles).
    const frame = new Rectangle(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    const bake = (node: Container, resolution: number): Sprite => {
      const texture = renderer.generateTexture({ target: node, frame, resolution, antialias: true });
      node.destroy({ children: true });
      this.baked.push(texture);
      return new Sprite(texture);
    };
    // Sea colour variation and islands share ONE baked layer (a single full-arena quad).
    // Fish swim underneath it, so they look submerged.
    const scenery = new Container();
    scenery.addChild(Ambience.buildSea(), islandLayer);
    const sceneryLayer = bake(scenery, Math.min(window.devicePixelRatio || 1, 2));

    this.world.addChild(
      this.ambience.fishLayer,
      sceneryLayer,
      this.wreckLayer,
      this.projectileLayer,
      this.shipLayer,
      this.effectLayer,
      this.ambience.birdLayer,
      this.barLayer,
    );
  }

  /**
   * Fit the fixed-size arena into the viewport, preserving aspect ratio. The arena is centred;
   * the screen-space sea fills the remaining area, so the whole screen shows water.
   */
  resize(viewWidth: number, viewHeight: number): void {
    const scale = Math.min(viewWidth / ARENA_WIDTH, viewHeight / ARENA_HEIGHT);
    this.scale = scale;
    this.water.width = viewWidth;
    this.water.height = viewHeight;
    this.water.tileScale.set(this.waterTileScale * scale);
    this.world.scale.set(scale);
    this.world.position.set((viewWidth - ARENA_WIDTH * scale) / 2, (viewHeight - ARENA_HEIGHT * scale) / 2);
    this.baseX = this.world.position.x;
    this.baseY = this.world.position.y;
  }
  private baseX = 0;
  private baseY = 0;
  private scale = 1;
  private readonly waterTileScale: number;

  /** Sync visuals with the simulation. `dt` is real frame time (seconds) for visual-only animation. */
  render(sim: Simulation, events: GameEvent[], dt: number, animate: boolean): void {
    if (animate) {
      this.time += dt;
      this.ambience.update(dt);
    }

    for (const ev of events) this.handleEvent(ev);

    const alive = new Set<number>();
    this.syncShip(sim.player, alive);
    for (const e of sim.enemies) this.syncShip(e, alive);
    for (const [id, view] of this.ships) {
      if (!alive.has(id)) {
        view.root.destroy({ children: true });
        view.bar.destroy({ children: true });
        this.ships.delete(id);
      }
    }

    const live = new Set<number>();
    for (const p of sim.projectiles) {
      live.add(p.id);
      let s = this.projectiles.get(p.id);
      if (!s) {
        s = this.projectilePool.pop() ?? new Sprite(this.tex.cannonBall);
        s.anchor.set(0.5);
        s.visible = true;
        s.tint = p.owner === 'player' ? 0xffffff : 0xffb0a0;
        this.projectileLayer.addChild(s);
        this.projectiles.set(p.id, s);
      }
      s.position.set(p.pos.x, p.pos.y);
    }
    for (const [id, s] of this.projectiles) {
      if (live.has(id)) continue;
      s.removeFromParent();
      this.projectilePool.push(s);
      this.projectiles.delete(id);
    }

    if (animate) {
      this.effects = this.effects.filter((fx) => {
        fx.age += dt;
        const t = Math.min(1, fx.age / fx.duration);
        fx.update(t);
        if (t >= 1) {
          fx.node.destroy({ children: true });
          return false;
        }
        return true;
      });
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    this.world.position.set(this.baseX + sx, this.baseY + sy);
    // Keep the sea aligned with the arena (including camera shake) plus a slow drift.
    this.water.tilePosition.set(this.world.position.x + this.time * 6 * this.scale, this.world.position.y + this.time * 3 * this.scale);
  }

  get entityCount(): number {
    return this.ships.size + this.projectiles.size + this.effects.length;
  }

  destroy(): void {
    for (const s of this.projectilePool) s.destroy();
    this.projectilePool.length = 0;
    this.ships.clear();
    this.projectiles.clear();
    this.effects = [];
    this.ambience.destroy();
    this.stage.destroy({ children: true });
    for (const t of this.baked) t.destroy(true);
    this.baked.length = 0;
  }

  // ------------------------------------------------------------------

  private colorOf(kind: ShipKind): number {
    return SHIP_COLOR[kind];
  }

  private syncShip(ship: Ship, alive: Set<number>): void {
    if (!ship.alive) return;
    alive.add(ship.id);
    let view = this.ships.get(ship.id);
    if (!view) view = this.createShipView(ship);
    const stage = damageStage(ship.hp, ship.maxHp);
    if (stage !== view.lastStage) {
      view.hull.texture = this.tex.ship(this.colorOf(ship.kind), stage);
      view.lastStage = stage;
    }
    view.root.position.set(ship.pos.x, ship.pos.y);
    view.root.rotation = ship.angle;
    view.hull.tint = ship.hitFlash > 0 ? 0xff7a6a : 0xffffff;
    view.fire.visible = stage > 0;
    if (view.fire.visible) {
      view.fire.texture = this.tex.fire[Math.floor(this.time * 10) % 2]!;
      view.fire.scale.set(stage === 2 ? 1.1 : 0.75);
    }
    const ratio = ship.hp / ship.maxHp;
    if (ratio !== view.lastRatio) {
      this.drawBar(view.barFill, ratio, ship.kind === 'player');
      view.lastRatio = ratio;
    }
    const scale = SHIP_SCALE[ship.kind];
    view.bar.position.set(ship.pos.x, ship.pos.y - 62 * scale - 10);
  }

  private createShipView(ship: Ship): ShipView {
    const root = new Container();
    const hull = new Sprite(this.tex.ship(this.colorOf(ship.kind), 0));
    hull.anchor.set(0.5);
    hull.scale.set(SHIP_SCALE[ship.kind]);
    const fire = new Sprite(this.tex.fire[0]!);
    fire.anchor.set(0.5, 0.9);
    fire.position.set(6, 4);
    fire.visible = false;
    root.addChild(hull, fire);
    this.shipLayer.addChild(root);

    const bar = new Container();
    const frame = new Sprite(this.tex.ui.textures['enemy_health_frame']);
    frame.anchor.set(0.5);
    frame.scale.set(BAR_FRAME_SCALE);
    const barFill = new Graphics();
    // draw_order from ui_sheet.json: frame first, then fill.
    bar.addChild(frame, barFill);
    this.barLayer.addChild(bar);

    const view: ShipView = { root, hull, fire, bar, barFill, lastStage: 0, lastRatio: -1 };
    this.ships.set(ship.id, view);
    return view;
  }

  private drawBar(g: Graphics, ratio: number, isPlayer: boolean): void {
    // fill_rect from ui_sheet.json "enemy_health" group: x 24, y 12, w 112, h 15 within a 160×40 frame.
    const s = BAR_FRAME_SCALE;
    const x = (24 - 80) * s;
    const y = (12 - 20) * s;
    const w = 112 * s;
    const h = 15 * s;
    const color = isPlayer ? (ratio > 0.5 ? 0x4cc94c : ratio > 0.25 ? 0xf0a830 : 0xe0403a) : 0xe0403a;
    g.clear().rect(x, y, w, h).fill({ color: 0x1b1b2a, alpha: 0 }).rect(x, y, w * Math.max(0, ratio), h).fill({ color });
  }

  private handleEvent(ev: GameEvent): void {
    switch (ev.type) {
      case 'shot': {
        const big = ev.weapon === 'left' || ev.weapon === 'right';
        this.spawnFlash(ev.x, ev.y, big ? 0.55 : 0.35, 0.18);
        this.spawnSmoke(ev.x, ev.y, big ? 26 : 14);
        break;
      }
      case 'hit':
        this.spawnFlash(ev.x, ev.y, 0.5, 0.25);
        if (ev.targetKind === 'player') this.shake = Math.max(this.shake, 10);
        break;
      case 'splash':
        this.spawnSplash(ev.x, ev.y);
        break;
      case 'ram':
        this.shake = Math.max(this.shake, 16);
        break;
      case 'destroyed':
        this.spawnExplosion(ev.ship.pos.x, ev.ship.pos.y, ev.ship.kind === 'player' ? 1.4 : 1);
        this.spawnWreck(ev.ship);
        break;
      default:
        break;
    }
  }

  private addEffect(node: Container, duration: number, update: (t: number) => void, layer = this.effectLayer): void {
    layer.addChild(node);
    update(0);
    this.effects.push({ node, age: 0, duration, update });
  }

  private spawnFlash(x: number, y: number, scale: number, duration: number): void {
    const s = new Sprite(this.tex.explosion[0]!);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.rotation = Math.random() * Math.PI;
    this.addEffect(s, duration, (t) => {
      s.scale.set(scale * (0.6 + t * 0.6));
      s.alpha = 1 - t;
    });
  }

  private spawnSmoke(x: number, y: number, radius: number): void {
    const g = new Graphics().circle(0, 0, radius).fill({ color: 0xeeeeee, alpha: 0.55 });
    g.position.set(x, y);
    this.addEffect(g, 0.6, (t) => {
      g.scale.set(0.5 + t);
      g.alpha = 0.7 * (1 - t);
    });
  }

  private spawnSplash(x: number, y: number): void {
    const g = new Graphics().circle(0, 0, 10).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
    g.position.set(x, y);
    this.addEffect(g, 0.45, (t) => {
      g.scale.set(0.4 + t * 1.4);
      g.alpha = 1 - t;
    });
  }

  private spawnExplosion(x: number, y: number, scale: number): void {
    const s = new Sprite(this.tex.explosion[0]!);
    s.anchor.set(0.5);
    s.position.set(x, y);
    const frames: Texture[] = this.tex.explosion;
    this.addEffect(s, 0.7, (t) => {
      s.texture = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))]!;
      s.scale.set(scale * (0.8 + t * 0.9));
      s.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    });
  }

  private spawnWreck(ship: Ship): void {
    const s = new Sprite(this.tex.ship(this.colorOf(ship.kind), 3));
    s.anchor.set(0.5);
    s.position.set(ship.pos.x, ship.pos.y);
    s.rotation = ship.angle;
    const base = SHIP_SCALE[ship.kind];
    const sinking = ship.kind !== 'player';
    this.addEffect(
      s,
      sinking ? 1.8 : 60,
      (t) => {
        if (!sinking) return;
        s.scale.set(base * (1 - t * 0.35));
        s.alpha = 1 - t;
        s.rotation = ship.angle + t * 0.4;
      },
      this.wreckLayer,
    );
  }
}
