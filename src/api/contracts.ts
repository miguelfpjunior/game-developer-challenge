/**
 * Typed REST contracts for ranking and match history.
 * Shared by the Axios client, TanStack Query hooks, MSW handlers and fixtures.
 */

export type EndReason = 'time_up' | 'destroyed';

export interface MatchConfigUsed {
  sessionSeconds: number;
  spawnIntervalSeconds: number;
  /** Ranking compares only matches with the same key. */
  configKey: string;
}

export interface MatchRecord {
  /** Client-generated UUID. Also the idempotency key for POST /matches. */
  matchId: string;
  playerId: string;
  playerName: string;
  /** ISO-8601 end time of the match. */
  playedAt: string;
  score: number;
  /** Effective (active, unpaused) duration in seconds. */
  durationSeconds: number;
  endReason: EndReason;
  config: MatchConfigUsed;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface RankingEntry {
  rank: number;
  matchId: string;
  playerId: string;
  playerName: string;
  score: number;
  durationSeconds: number;
  endReason: EndReason;
  playedAt: string;
}

export interface RankingQuery {
  configKey: string;
  page: number;
  pageSize: number;
}

export interface HistoryQuery {
  playerId: string;
  page: number;
  pageSize: number;
}

export interface CreateMatchResponse {
  record: MatchRecord;
  /** false when the matchId already existed (idempotent replay). */
  created: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const API_ROUTES = {
  ranking: '/api/ranking',
  matches: '/api/matches',
  playerMatches: (playerId: string) => `/api/players/${encodeURIComponent(playerId)}/matches`,
} as const;

/**
 * Deterministic ranking order: score desc, then longer survival (duration desc),
 * then earlier playedAt (first to reach it), then matchId as the final tie-breaker.
 */
export function compareRanking(a: MatchRecord, b: MatchRecord): number {
  return (
    b.score - a.score ||
    b.durationSeconds - a.durationSeconds ||
    a.playedAt.localeCompare(b.playedAt) ||
    a.matchId.localeCompare(b.matchId)
  );
}
