import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ISLANDS,
  PLAYER_START,
  circleHitsAnyIsland,
  insideArena,
  pointHitsAnyIsland,
  resolveCircleVsCollider,
} from './arena';
import type { EnemyKind, GameConfig, ShipConfig, WeaponConfig } from './config';
import { type Vec2, angleTo, clamp, createRng, dist, forward, rightOf, wrapAngle } from './math';

/**
 * Pure game rules. No rendering, no DOM, no timers: the owner calls `step(dt, input)`
 * with a fixed timestep, which makes the simulation frame-rate independent and testable.
 */

export type ShipKind = 'player' | EnemyKind;
export type EndReason = 'time_up' | 'destroyed';
export type Phase = 'running' | 'ended';

export interface InputState {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
}

export const EMPTY_INPUT: Readonly<InputState> = Object.freeze({
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
});

export interface Ship {
  id: number;
  kind: ShipKind;
  pos: Vec2;
  angle: number;
  speed: number;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  hitFlash: number;
  /** Weapon cooldowns in seconds (remaining). */
  cooldowns: { front: number; left: number; right: number };
}

export interface Projectile {
  id: number;
  owner: 'player' | 'enemy';
  pos: Vec2;
  vel: Vec2;
  damage: number;
  distanceLeft: number;
  timeLeft: number;
  alive: boolean;
}

export type GameEvent =
  | { type: 'shot'; weapon: 'front' | 'left' | 'right' | 'enemy'; x: number; y: number; angle: number }
  | { type: 'hit'; targetId: number; targetKind: ShipKind; x: number; y: number }
  | { type: 'splash'; x: number; y: number }
  | { type: 'destroyed'; ship: Ship; byPlayer: boolean; rammed: boolean }
  | { type: 'score'; score: number }
  | { type: 'spawn'; ship: Ship }
  | { type: 'ram'; x: number; y: number }
  | { type: 'ended'; reason: EndReason };

export interface SimulationSnapshot {
  phase: Phase;
  elapsed: number;
  timeLeft: number;
  score: number;
  endReason: EndReason | null;
  player: { x: number; y: number; angle: number; hp: number; maxHp: number; speed: number };
  enemies: Array<{ id: number; kind: EnemyKind; x: number; y: number; angle: number; hp: number; maxHp: number }>;
  projectiles: number;
  spawned: { chaser: number; shooter: number };
  kills: number;
  shotsFired: number;
}

export class Simulation {
  readonly config: GameConfig;
  readonly player: Ship;
  readonly enemies: Ship[] = [];
  readonly projectiles: Projectile[] = [];
  phase: Phase = 'running';
  elapsed = 0;
  score = 0;
  endReason: EndReason | null = null;
  spawned = { chaser: 0, shooter: 0 };
  shotsFired = 0;

  private nextId = 1;
  private spawnTimer: number;
  private spawnCount = 0;
  private readonly rng: () => number;
  private events: GameEvent[] = [];

  constructor(config: GameConfig, seed: number) {
    this.config = config;
    this.rng = createRng(seed);
    this.player = this.createShip('player', { ...PLAYER_START }, Math.PI / 2, config.player);
    // First spawn arrives quickly so the arena is never empty for long.
    this.spawnTimer = Math.min(1.5, config.spawn.interval);
  }

  get timeLeft(): number {
    return Math.max(0, this.config.sessionSeconds - this.elapsed);
  }

  /** Drain events produced since the last call (consumed by renderer / audio / UI bridge). */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number, input: InputState): void {
    if (this.phase !== 'running') return;
    this.elapsed += dt;

    this.updatePlayer(dt, input);
    this.updateSpawns(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.separateShips();
    this.updateProjectiles(dt);

    this.removeDead();

    if (this.player.hp <= 0) this.end('destroyed');
    else if (this.elapsed >= this.config.sessionSeconds) {
      this.elapsed = this.config.sessionSeconds;
      this.end('time_up');
    }
  }

  snapshot(): SimulationSnapshot {
    const p = this.player;
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      timeLeft: this.timeLeft,
      score: this.score,
      endReason: this.endReason,
      player: { x: p.pos.x, y: p.pos.y, angle: p.angle, hp: p.hp, maxHp: p.maxHp, speed: p.speed },
      enemies: this.enemies.map((e) => ({
        id: e.id,
        kind: e.kind as EnemyKind,
        x: e.pos.x,
        y: e.pos.y,
        angle: e.angle,
        hp: e.hp,
        maxHp: e.maxHp,
      })),
      projectiles: this.projectiles.length,
      spawned: { ...this.spawned },
      kills: this.score,
      shotsFired: this.shotsFired,
    };
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(dt: number, input: InputState): void {
    const p = this.player;
    const cfg = this.config.player;
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
    p.angle = wrapAngle(p.angle + turn * cfg.turnSpeed * dt);
    const target = input.forward ? cfg.speed : 0;
    p.speed = approach(p.speed, target, (input.forward ? cfg.acceleration : cfg.acceleration * 1.2) * dt);
    this.moveShip(p, dt);
    this.tickCooldowns(p, dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);

    const fwd = forward(p.angle);
    const right = rightOf(p.angle);
    if (input.fireFront && p.cooldowns.front <= 0) {
      const w = cfg.frontWeapon;
      p.cooldowns.front = w.cooldown;
      const origin = { x: p.pos.x + fwd.x * (p.radius + 14), y: p.pos.y + fwd.y * (p.radius + 14) };
      this.fire('player', origin, p.angle, w);
      this.events.push({ type: 'shot', weapon: 'front', x: origin.x, y: origin.y, angle: p.angle });
    }
    for (const side of ['left', 'right'] as const) {
      const pressed = side === 'left' ? input.fireLeft : input.fireRight;
      if (!pressed || p.cooldowns[side] > 0) continue;
      const w = cfg.sideWeapon;
      p.cooldowns[side] = w.cooldown;
      const sign = side === 'right' ? 1 : -1;
      const dir = p.angle + (sign * Math.PI) / 2;
      const half = (w.projectiles - 1) / 2;
      for (let i = 0; i < w.projectiles; i++) {
        const along = (i - half) * w.spacing;
        const origin = {
          x: p.pos.x + fwd.x * along + right.x * sign * (p.radius - 4),
          y: p.pos.y + fwd.y * along + right.y * sign * (p.radius - 4),
        };
        this.fire('player', origin, dir, w);
      }
      this.events.push({
        type: 'shot',
        weapon: side,
        x: p.pos.x + right.x * sign * p.radius,
        y: p.pos.y + right.y * sign * p.radius,
        angle: dir,
      });
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateSpawns(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer += this.config.spawn.interval;
    if (this.enemies.length >= this.config.spawn.maxAlive) return;
    const kind = this.pickEnemyKind();
    const pos = this.findSpawnPoint(kind === 'chaser' ? this.config.chaser.radius : this.config.shooter.radius);
    if (!pos) return; // No safe point this tick; try again next interval.
    const cfg = kind === 'chaser' ? this.config.chaser : this.config.shooter;
    const ship = this.createShip(kind, pos, angleTo(pos, this.player.pos), cfg);
    this.enemies.push(ship);
    this.spawned[kind]++;
    this.spawnCount++;
    this.events.push({ type: 'spawn', ship });
  }

  private pickEnemyKind(): EnemyKind {
    const opening = this.config.spawn.openingSequence[this.spawnCount];
    if (opening) return opening;
    const { chaser, shooter } = this.config.spawn.weights;
    return this.rng() * (chaser + shooter) < chaser ? 'chaser' : 'shooter';
  }

  private findSpawnPoint(radius: number): Vec2 | null {
    const margin = radius + 24;
    for (let i = 0; i < 40; i++) {
      // Prefer the arena border so enemies sail in from the edges.
      const edge = Math.floor(this.rng() * 4);
      const t = this.rng();
      const pos =
        edge === 0
          ? { x: margin + t * (ARENA_WIDTH - 2 * margin), y: margin }
          : edge === 1
            ? { x: ARENA_WIDTH - margin, y: margin + t * (ARENA_HEIGHT - 2 * margin) }
            : edge === 2
              ? { x: margin + t * (ARENA_WIDTH - 2 * margin), y: ARENA_HEIGHT - margin }
              : { x: margin, y: margin + t * (ARENA_HEIGHT - 2 * margin) };
      if (dist(pos, this.player.pos) < this.config.spawn.minDistanceFromPlayer) continue;
      if (circleHitsAnyIsland(pos, radius + 16)) continue;
      if (this.enemies.some((e) => dist(e.pos, pos) < e.radius + radius + 12)) continue;
      return pos;
    }
    return null;
  }

  private updateEnemy(e: Ship, dt: number): void {
    const target = this.player.pos;
    const d = dist(e.pos, target);
    let desired = angleTo(e.pos, target);
    let throttle = 1;
    let cfg: ShipConfig;

    if (e.kind === 'shooter') {
      const s = this.config.shooter;
      cfg = s;
      if (d < s.preferredDistance) throttle = 0.15;
    } else {
      cfg = this.config.chaser;
    }

    desired = this.avoidObstacles(e, desired);
    const diff = wrapAngle(desired - e.angle);
    const maxTurn = cfg.turnSpeed * dt;
    e.angle = wrapAngle(e.angle + clamp(diff, -maxTurn, maxTurn));
    // Slow down while turning sharply so ships can manoeuvre around islands.
    const turnPenalty = Math.abs(diff) > 1.2 ? 0.5 : 1;
    e.speed = approach(e.speed, cfg.speed * throttle * turnPenalty, cfg.acceleration * dt);
    this.moveShip(e, dt);
    this.tickCooldowns(e, dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);

    if (e.kind === 'shooter') {
      const s = this.config.shooter;
      const aim = Math.abs(wrapAngle(angleTo(e.pos, target) - e.angle));
      if (d <= s.attackRange && aim <= s.aimTolerance && e.cooldowns.front <= 0) {
        e.cooldowns.front = s.weapon.cooldown;
        const fwd = forward(e.angle);
        const origin = { x: e.pos.x + fwd.x * (e.radius + 12), y: e.pos.y + fwd.y * (e.radius + 12) };
        this.fire('enemy', origin, e.angle, s.weapon);
        this.events.push({ type: 'shot', weapon: 'enemy', x: origin.x, y: origin.y, angle: e.angle });
      }
    } else if (d < e.radius + this.player.radius) {
      // Chaser rams the player: damage + self-destruct, no score.
      this.damagePlayer(this.config.chaser.ramDamage, e.pos);
      e.hp = 0;
      e.alive = false;
      this.events.push({ type: 'ram', x: e.pos.x, y: e.pos.y });
      this.events.push({ type: 'destroyed', ship: e, byPlayer: false, rammed: true });
    }
  }

  /** Simple whisker steering: if the heading probe hits an island or wall, pick the freer side. */
  private avoidObstacles(e: Ship, desired: number): number {
    const look = e.radius + 70;
    const blocked = (a: number) => {
      const f = forward(a);
      const probe = { x: e.pos.x + f.x * look, y: e.pos.y + f.y * look };
      return circleHitsAnyIsland(probe, e.radius * 0.8) || !insideArena(probe, e.radius);
    };
    if (!blocked(desired)) return desired;
    for (const delta of [0.5, 1, 1.5, 2.2]) {
      const left = desired - delta;
      const right = desired + delta;
      const leftFree = !blocked(left);
      const rightFree = !blocked(right);
      if (leftFree && rightFree) {
        return Math.abs(wrapAngle(left - e.angle)) < Math.abs(wrapAngle(right - e.angle)) ? left : right;
      }
      if (leftFree) return left;
      if (rightFree) return right;
    }
    return e.angle + Math.PI / 2;
  }

  // ---------------------------------------------------------------- physics

  private moveShip(s: Ship, dt: number): void {
    const f = forward(s.angle);
    s.pos.x += f.x * s.speed * dt;
    s.pos.y += f.y * s.speed * dt;
    let bumped = false;
    for (const island of ISLANDS) bumped = resolveCircleVsCollider(island.collider, s.pos, s.radius) || bumped;
    const cx = clamp(s.pos.x, s.radius, ARENA_WIDTH - s.radius);
    const cy = clamp(s.pos.y, s.radius, ARENA_HEIGHT - s.radius);
    if (cx !== s.pos.x || cy !== s.pos.y) bumped = true;
    s.pos.x = cx;
    s.pos.y = cy;
    if (bumped) s.speed *= 0.85;
  }

  private separateShips(): void {
    const ships = [this.player, ...this.enemies.filter((e) => e.alive)];
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i]!;
        const b = ships[j]!;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = a.radius + b.radius - d;
        if (overlap <= 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= (nx * overlap) / 2;
        a.pos.y -= (ny * overlap) / 2;
        b.pos.x += (nx * overlap) / 2;
        b.pos.y += (ny * overlap) / 2;
      }
    }
    // Separation may push ships into islands or walls: re-resolve.
    for (const s of ships) {
      for (const island of ISLANDS) resolveCircleVsCollider(island.collider, s.pos, s.radius);
      s.pos.x = clamp(s.pos.x, s.radius, ARENA_WIDTH - s.radius);
      s.pos.y = clamp(s.pos.y, s.radius, ARENA_HEIGHT - s.radius);
    }
  }

  private fire(owner: Projectile['owner'], origin: Vec2, angle: number, w: WeaponConfig): void {
    const f = forward(angle);
    this.projectiles.push({
      id: this.nextId++,
      owner,
      pos: { ...origin },
      vel: { x: f.x * w.projectileSpeed, y: f.y * w.projectileSpeed },
      damage: w.damage,
      distanceLeft: w.range,
      timeLeft: w.lifetime,
      alive: true,
    });
    if (owner === 'player') this.shotsFired++;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const stepX = p.vel.x * dt;
      const stepY = p.vel.y * dt;
      p.pos.x += stepX;
      p.pos.y += stepY;
      p.distanceLeft -= Math.hypot(stepX, stepY);
      p.timeLeft -= dt;

      if (!insideArena(p.pos)) {
        p.alive = false;
        continue;
      }
      if (pointHitsAnyIsland(p.pos)) {
        p.alive = false;
        this.events.push({ type: 'splash', x: p.pos.x, y: p.pos.y });
        continue;
      }
      if (p.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.alive || dist(e.pos, p.pos) > e.radius) continue;
          p.alive = false;
          this.damageEnemy(e, p.damage, p.pos);
          break;
        }
      } else if (dist(this.player.pos, p.pos) <= this.player.radius) {
        p.alive = false;
        this.damagePlayer(p.damage, p.pos);
      }
      if (p.alive && (p.distanceLeft <= 0 || p.timeLeft <= 0)) {
        p.alive = false;
        this.events.push({ type: 'splash', x: p.pos.x, y: p.pos.y });
      }
    }
  }

  private damageEnemy(e: Ship, damage: number, at: Vec2): void {
    e.hp = Math.max(0, e.hp - damage);
    e.hitFlash = this.config.hitFlashSeconds;
    this.events.push({ type: 'hit', targetId: e.id, targetKind: e.kind, x: at.x, y: at.y });
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      this.score += 1;
      this.events.push({ type: 'destroyed', ship: e, byPlayer: true, rammed: false });
      this.events.push({ type: 'score', score: this.score });
    }
  }

  private damagePlayer(damage: number, at: Vec2): void {
    const p = this.player;
    if (p.hp <= 0) return;
    p.hp = Math.max(0, p.hp - damage);
    p.hitFlash = this.config.hitFlashSeconds;
    this.events.push({ type: 'hit', targetId: p.id, targetKind: 'player', x: at.x, y: at.y });
    if (p.hp <= 0) {
      p.alive = false;
      this.events.push({ type: 'destroyed', ship: p, byPlayer: false, rammed: false });
    }
  }

  private removeDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i]!.alive) this.enemies.splice(i, 1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1);
  }

  private end(reason: EndReason): void {
    this.phase = 'ended';
    this.endReason = reason;
    this.events.push({ type: 'ended', reason });
  }

  private tickCooldowns(s: Ship, dt: number): void {
    s.cooldowns.front = Math.max(0, s.cooldowns.front - dt);
    s.cooldowns.left = Math.max(0, s.cooldowns.left - dt);
    s.cooldowns.right = Math.max(0, s.cooldowns.right - dt);
  }

  private createShip(kind: ShipKind, pos: Vec2, angle: number, cfg: ShipConfig): Ship {
    return {
      id: this.nextId++,
      kind,
      pos,
      angle,
      speed: 0,
      hp: cfg.maxHealth,
      maxHp: cfg.maxHealth,
      radius: cfg.radius,
      alive: true,
      hitFlash: 0,
      cooldowns: { front: 0, left: 0, right: 0 },
    };
  }
}

function approach(v: number, target: number, delta: number): number {
  return v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);
}
