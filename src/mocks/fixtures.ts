import type { EndReason, MatchRecord } from '../api/contracts';
import { configKey } from '../game/config';
import { createRng } from '../game/math';

/** Deterministic fixtures representing other players. Same output for every environment. */
const NAMES = [
  'Blackbeard', 'Anne Bonny', 'Calico Jack', 'Mary Read', 'Red Legs', 'Grace O’Malley', 'Black Bart',
  'Ching Shih', 'Long Ben', 'Stede', 'Hornigold', 'Kidd', 'Morgan', 'Drake', 'Lafitte', 'Barbossa Jr',
  'Salty Sam', 'One-Eyed Lu', 'Coral Kate', 'Iron Hook',
];

const CONFIGS = [
  { sessionSeconds: 120, spawnIntervalSeconds: 3 }, // default options
  { sessionSeconds: 60, spawnIntervalSeconds: 2 },
  { sessionSeconds: 180, spawnIntervalSeconds: 3 },
];

export function buildFixtures(): MatchRecord[] {
  const rng = createRng(20260101);
  const records: MatchRecord[] = [];
  const base = Date.UTC(2026, 9, 1, 12, 0, 0);
  let n = 0;
  for (const cfg of CONFIGS) {
    const count = cfg.sessionSeconds === 120 ? 34 : 12;
    for (let i = 0; i < count; i++) {
      n++;
      const nameIdx = Math.floor(rng() * NAMES.length);
      const died = rng() < 0.4;
      const reason: EndReason = died ? 'destroyed' : 'time_up';
      const duration = died ? Math.round((20 + rng() * (cfg.sessionSeconds - 25)) * 10) / 10 : cfg.sessionSeconds;
      const score = Math.floor(rng() * (duration / cfg.spawnIntervalSeconds) * 0.7);
      records.push({
        matchId: `fixture-${String(n).padStart(3, '0')}`,
        playerId: `fixture-player-${nameIdx}`,
        playerName: NAMES[nameIdx]!,
        playedAt: new Date(base + n * 3_600_000).toISOString(),
        score,
        durationSeconds: duration,
        endReason: reason,
        config: { ...cfg, configKey: configKey(cfg) },
      });
    }
  }
  return records;
}
