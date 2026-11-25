import axios, { AxiosError } from 'axios';
import {
  API_ROUTES,
  type ApiErrorBody,
  type CreateMatchResponse,
  type HistoryQuery,
  type MatchRecord,
  type Page,
  type RankingEntry,
  type RankingQuery,
} from './contracts';

export const REQUEST_TIMEOUT_MS = 5000;

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

export type ApiErrorKind = 'timeout' | 'network' | 'client' | 'server' | 'cancelled' | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  constructor(kind: ApiErrorKind, message: string, status: number | null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
  /** Worth retrying automatically? Timeouts, connection failures and 5xx yes; 4xx no. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'server';
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (axios.isCancel(err)) return new ApiError('cancelled', 'Request cancelled.', null);
  if (err instanceof AxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new ApiError('timeout', 'The server took too long to respond.', null);
    }
    if (!err.response) return new ApiError('network', 'Could not reach the server.', null);
    const status = err.response.status;
    const body = err.response.data as Partial<ApiErrorBody> | undefined;
    const message = body?.error?.message ?? `Request failed with status ${status}.`;
    return new ApiError(status >= 500 ? 'server' : 'client', message, status);
  }
  return new ApiError('unknown', err instanceof Error ? err.message : 'Unknown error.', null);
}

async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data;
  } catch (e) {
    throw toApiError(e);
  }
}

export const api = {
  getRanking: (q: RankingQuery, signal?: AbortSignal) =>
    call(() => http.get<Page<RankingEntry>>(API_ROUTES.ranking, { params: q, signal })),

  getHistory: (q: HistoryQuery, signal?: AbortSignal) =>
    call(() =>
      http.get<Page<MatchRecord>>(API_ROUTES.playerMatches(q.playerId), {
        params: { page: q.page, pageSize: q.pageSize },
        signal,
      }),
    ),

  createMatch: (record: MatchRecord) =>
    call(() =>
      http.post<CreateMatchResponse>(API_ROUTES.matches, record, {
        headers: { 'Idempotency-Key': record.matchId },
      }),
    ),
};
