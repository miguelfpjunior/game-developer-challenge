import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { ApiError, api, toApiError } from './client';
import type { CreateMatchResponse, MatchRecord } from './contracts';
import { outboxStore, unsentSubmissions, upsertSubmission } from './pending';

export const PAGE_SIZE = 8;

export const queryKeys = {
  ranking: (configKey: string, page: number) => ['ranking', configKey, page] as const,
  rankingAll: ['ranking'] as const,
  history: (playerId: string, page: number) => ['history', playerId, page] as const,
  historyAll: ['history'] as const,
};

function shouldRetry(failureCount: number, error: unknown): boolean {
  const e = toApiError(error);
  return e.retryable && failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 3000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function useRanking(configKey: string, page: number) {
  return useQuery({
    queryKey: queryKeys.ranking(configKey, page),
    // TanStack passes an AbortSignal: superseded requests are cancelled, and results are
    // stored per key, so a late answer can never overwrite newer data for another page.
    queryFn: ({ signal }) => api.getRanking({ configKey, page, pageSize: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function useHistory(playerId: string, page: number) {
  return useQuery({
    queryKey: queryKeys.history(playerId, page),
    queryFn: ({ signal }) => api.getHistory({ playerId, page, pageSize: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

/** One in-flight request per matchId: double clicks and auto-retries share the same promise. */
const inflight = new Map<string, Promise<CreateMatchResponse>>();

async function sendOnce(record: MatchRecord): Promise<CreateMatchResponse> {
  const existing = inflight.get(record.matchId);
  if (existing) return existing;
  const prev = outboxStore.get()[record.matchId];
  upsertSubmission(record.matchId, { record, status: 'sending', attempts: (prev?.attempts ?? 0) + 1 });
  const p = (async () => {
    let lastError: ApiError | null = null;
    // A couple of quick retries for transient failures; the outbox keeps the rest.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await api.createMatch(record);
      } catch (e) {
        lastError = toApiError(e);
        if (!lastError.retryable) break;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastError ?? new ApiError('unknown', 'Unknown error.', null);
  })();
  inflight.set(record.matchId, p);
  try {
    return await p;
  } finally {
    inflight.delete(record.matchId);
  }
}

export function useSubmitMatch() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['submitMatch'],
    mutationFn: sendOnce,
    onSuccess: (res) => {
      upsertSubmission(res.record.matchId, { status: 'saved', lastError: null });
      void qc.invalidateQueries({ queryKey: queryKeys.rankingAll });
      void qc.invalidateQueries({ queryKey: queryKeys.historyAll });
    },
    onError: (err, record) => {
      upsertSubmission(record.matchId, { status: 'failed', lastError: toApiError(err).message });
    },
  });
  const { mutate } = mutation;
  const submit = useCallback(
    (record: MatchRecord) => {
      upsertSubmission(record.matchId, { record });
      mutate(record);
    },
    [mutate],
  );
  return submit;
}

/** On app start (and when the browser comes back online) resend anything left in the outbox. */
export function useOutboxRecovery() {
  const submit = useSubmitMatch();
  useEffect(() => {
    const flush = () => {
      for (const s of unsentSubmissions()) if (s.status !== 'sending') submit(s.record);
    };
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [submit]);
}
