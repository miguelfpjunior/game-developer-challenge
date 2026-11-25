import { compareRanking, type MatchRecord, type Page, type RankingEntry } from '../api/contracts';
import { buildFixtures } from './fixtures';

/** Mock "server" database persisted in localStorage so confirmed records survive refresh. */
const DB_KEY = 'pb.mock.db.v1';

function load(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as MatchRecord[];
  } catch {
    /* fall through to fixtures */
  }
  const fixtures = buildFixtures();
  save(fixtures);
  return fixtures;
}

function save(records: MatchRecord[]): void {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(records));
  } catch {
    /* ignore */
  }
}

export function resetDb(): void {
  save(buildFixtures());
}

export function findMatch(matchId: string): MatchRecord | undefined {
  return load().find((r) => r.matchId === matchId);
}

/** Idempotent insert keyed by matchId. */
export function insertMatch(record: MatchRecord): { record: MatchRecord; created: boolean } {
  const all = load();
  const existing = all.find((r) => r.matchId === record.matchId);
  if (existing) return { record: existing, created: false };
  all.push(record);
  save(all);
  return { record, created: true };
}

function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), page: p, pageSize, totalItems, totalPages };
}

export function queryRanking(configKey: string, page: number, pageSize: number): Page<RankingEntry> {
  const sorted = load()
    .filter((r) => r.config.configKey === configKey)
    .sort(compareRanking)
    .map<RankingEntry>((r, i) => ({
      rank: i + 1,
      matchId: r.matchId,
      playerId: r.playerId,
      playerName: r.playerName,
      score: r.score,
      durationSeconds: r.durationSeconds,
      endReason: r.endReason,
      playedAt: r.playedAt,
    }));
  return paginate(sorted, page, pageSize);
}

export function queryHistory(playerId: string, page: number, pageSize: number): Page<MatchRecord> {
  const mine = load()
    .filter((r) => r.playerId === playerId)
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.matchId.localeCompare(b.matchId));
  return paginate(mine, page, pageSize);
}
