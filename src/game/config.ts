/**
 * Central, typed gameplay configuration.
 * Balance changes happen here only — systems read every value from a config snapshot.
 */

export interface WeaponConfig {
  /** Seconds between two shots of this weapon. */
  cooldown: number;
  /** Damage per projectile. */
  damage: number;
  /** Projectile speed in world px / s. */
  projectileSpeed: number;
  /** Maximum travel distance in world px. */
  range: number;
  /** Maximum projectile lifetime in seconds (whichever ends first: range or lifetime). */
  lifetime: number;
}

export interface ShipConfig {
  maxHealth: number;
  /** Max forward speed, px / s. */
  speed: number;
  /** Forward acceleration, px / s². */
  acceleration: number;
  /** Rotation speed, rad / s. */
  turnSpeed: number;
  /** Collision radius, px. */
  radius: number;
}

export interface ChaserConfig extends ShipConfig {
  /** Damage dealt to the player when the Chaser rams it (Chaser explodes). */
  ramDamage: number;
}

export interface ShooterConfig extends ShipConfig {
  weapon: WeaponConfig;
  /** Distance at which the Shooter opens fire. */
  attackRange: number;
  /** Distance the Shooter tries to keep from the player. */
  preferredDistance: number;
  /** Max angle (rad) between heading and target for a shot. */
  aimTolerance: number;
}

export interface SpawnConfig {
  /** Seconds between spawns. */
  interval: number;
  /** Relative weights of each enemy type. */
  weights: { chaser: number; shooter: number };
  /** Enemy types forced for the first spawns, guaranteeing both types appear. */
  openingSequence: readonly EnemyKind[];
  /** Minimum distance between spawn point and player. */
  minDistanceFromPlayer: number;
  /** Max enemies alive at once (spawn skipped while capped). */
  maxAlive: number;
}

export type EnemyKind = 'chaser' | 'shooter';

export interface GameConfig {
  /** Active match duration in seconds. */
  sessionSeconds: number;
  spawn: SpawnConfig;
  player: ShipConfig & {
    frontWeapon: WeaponConfig;
    sideWeapon: WeaponConfig & { projectiles: number; spacing: number };
  };
  chaser: ChaserConfig;
  shooter: ShooterConfig;
  /** Seconds a ship stays invulnerable to repeated contact pushes (feedback only). */
  hitFlashSeconds: number;
}

/** Limits exposed by the Options screen (documented in README). */
export const OPTION_LIMITS = {
  sessionSeconds: { min: 60, max: 180, step: 5, default: 120 },
  spawnIntervalSeconds: { min: 0.5, max: 10, step: 0.5, default: 3 },
} as const;

export const DEFAULT_CONFIG: GameConfig = {
  sessionSeconds: OPTION_LIMITS.sessionSeconds.default,
  spawn: {
    interval: OPTION_LIMITS.spawnIntervalSeconds.default,
    weights: { chaser: 0.55, shooter: 0.45 },
    openingSequence: ['chaser', 'shooter'],
    minDistanceFromPlayer: 420,
    maxAlive: 10,
  },
  player: {
    maxHealth: 100,
    speed: 170,
    acceleration: 260,
    turnSpeed: 2.4,
    radius: 26,
    frontWeapon: { cooldown: 0.45, damage: 25, projectileSpeed: 520, range: 520, lifetime: 1.2 },
    sideWeapon: {
      cooldown: 1.4,
      damage: 20,
      projectileSpeed: 460,
      range: 360,
      lifetime: 1,
      projectiles: 3,
      spacing: 22,
    },
  },
  chaser: {
    maxHealth: 40,
    speed: 120,
    acceleration: 200,
    turnSpeed: 2.0,
    radius: 22,
    ramDamage: 20,
  },
  shooter: {
    maxHealth: 60,
    speed: 95,
    acceleration: 160,
    turnSpeed: 1.6,
    radius: 24,
    attackRange: 380,
    preferredDistance: 280,
    aimTolerance: 0.2,
    weapon: { cooldown: 2.0, damage: 8, projectileSpeed: 380, range: 420, lifetime: 1.4 },
  },
  hitFlashSeconds: 0.15,
};

/** Player-editable options (persisted). */
export interface PlayerOptions {
  sessionSeconds: number;
  spawnIntervalSeconds: number;
  playerName: string;
  soundEnabled: boolean;
}

/** Build an immutable config snapshot for one match from the current options. */
export function createConfigSnapshot(options: Pick<PlayerOptions, 'sessionSeconds' | 'spawnIntervalSeconds'>): GameConfig {
  const snapshot: GameConfig = structuredClone(DEFAULT_CONFIG);
  snapshot.sessionSeconds = options.sessionSeconds;
  snapshot.spawn.interval = options.spawnIntervalSeconds;
  return deepFreeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** Key identifying comparable matches in the ranking. */
export function configKey(options: { sessionSeconds: number; spawnIntervalSeconds: number }): string {
  return `t${options.sessionSeconds}-s${options.spawnIntervalSeconds}`;
}
