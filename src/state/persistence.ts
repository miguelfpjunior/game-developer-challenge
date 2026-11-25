import { OPTION_LIMITS, type PlayerOptions } from '../game/config';
import type { MatchRecord } from '../api/contracts';

/** Versioned localStorage keys. */
export const STORAGE_KEYS = {
  options: 'pb.options.v1',
  lastResult: 'pb.lastResult.v1',
  player: 'pb.player.v1',
  pending: 'pb.pendingMatches.v1',
} as const;

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled: non-fatal */
  }
}

// ---------------------------------------------------------------- player identity

export interface PlayerIdentity {
  playerId: string;
}

export function getPlayerId(): string {
  const existing = readJson<PlayerIdentity>(STORAGE_KEYS.player);
  if (existing?.playerId) return existing.playerId;
  const playerId = `player-${crypto.randomUUID()}`;
  writeJson(STORAGE_KEYS.player, { playerId });
  return playerId;
}

// ---------------------------------------------------------------- options

export const DEFAULT_OPTIONS: PlayerOptions = {
  sessionSeconds: OPTION_LIMITS.sessionSeconds.default,
  spawnIntervalSeconds: OPTION_LIMITS.spawnIntervalSeconds.default,
  playerName: 'Captain',
  soundEnabled: true,
};

export type OptionErrors = Partial<Record<keyof PlayerOptions, string>>;

export function validateOptions(o: {
  sessionSeconds: number;
  spawnIntervalSeconds: number;
  playerName: string;
}): OptionErrors {
  const errors: OptionErrors = {};
  const s = OPTION_LIMITS.sessionSeconds;
  if (!Number.isFinite(o.sessionSeconds) || !Number.isInteger(o.sessionSeconds)) {
    errors.sessionSeconds = 'Enter a whole number of seconds.';
  } else if (o.sessionSeconds < s.min || o.sessionSeconds > s.max) {
    errors.sessionSeconds = `Must be between ${s.min} and ${s.max} seconds.`;
  }
  const sp = OPTION_LIMITS.spawnIntervalSeconds;
  if (!Number.isFinite(o.spawnIntervalSeconds)) {
    errors.spawnIntervalSeconds = 'Enter a number of seconds.';
  } else if (o.spawnIntervalSeconds < sp.min || o.spawnIntervalSeconds > sp.max) {
    errors.spawnIntervalSeconds = `Must be between ${sp.min} and ${sp.max} seconds.`;
  } else if (Math.round(o.spawnIntervalSeconds / sp.step) * sp.step !== o.spawnIntervalSeconds) {
    errors.spawnIntervalSeconds = `Use steps of ${sp.step} seconds.`;
  }
  const name = o.playerName.trim();
  if (name.length < 2 || name.length > 16) errors.playerName = 'Name must have 2 to 16 characters.';
  else if (!/^[\p{L}\p{N} _-]+$/u.test(name)) errors.playerName = 'Use letters, numbers, spaces, - or _.';
  return errors;
}

export function loadOptions(): PlayerOptions {
  const stored = readJson<Partial<PlayerOptions>>(STORAGE_KEYS.options);
  const merged: PlayerOptions = { ...DEFAULT_OPTIONS, ...(stored ?? {}) };
  // Corrupted or out-of-range values fall back to defaults.
  const errors = validateOptions(merged);
  return {
    sessionSeconds: errors.sessionSeconds ? DEFAULT_OPTIONS.sessionSeconds : merged.sessionSeconds,
    spawnIntervalSeconds: errors.spawnIntervalSeconds ? DEFAULT_OPTIONS.spawnIntervalSeconds : merged.spawnIntervalSeconds,
    playerName: errors.playerName ? DEFAULT_OPTIONS.playerName : merged.playerName.trim(),
    soundEnabled: typeof merged.soundEnabled === 'boolean' ? merged.soundEnabled : true,
  };
}

export function saveOptions(o: PlayerOptions): void {
  writeJson(STORAGE_KEYS.options, o);
}

// ---------------------------------------------------------------- last result

export interface LastResult {
  record: MatchRecord;
}

export function loadLastResult(): LastResult | null {
  return readJson<LastResult>(STORAGE_KEYS.lastResult);
}

export function saveLastResult(r: LastResult): void {
  writeJson(STORAGE_KEYS.lastResult, r);
}
