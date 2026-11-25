import type { MatchRecord } from './contracts';
import { readJson, STORAGE_KEYS, writeJson } from '../state/persistence';
import { createStore } from '../state/store';

/**
 * Outbox of completed matches not yet confirmed by the server.
 * Persisted so a failed or interrupted submission survives refresh and can be retried.
 * The matchId is the idempotency key: resending never duplicates a record.
 */

export type SubmissionStatus = 'pending' | 'sending' | 'failed' | 'saved';

export interface Submission {
  record: MatchRecord;
  status: SubmissionStatus;
  attempts: number;
  lastError: string | null;
}

type Outbox = Record<string, Submission>;

function loadOutbox(): Outbox {
  const stored = readJson<Outbox>(STORAGE_KEYS.pending) ?? {};
  // A "sending" state cannot survive a reload: the request died with the page.
  for (const s of Object.values(stored)) if (s.status === 'sending') s.status = 'pending';
  return stored;
}

export const outboxStore = createStore<Outbox>(loadOutbox());

/** Saved records are kept in memory only (for the result screen), not persisted. */
function persist(next: Outbox): void {
  const unsaved: Outbox = {};
  for (const [id, s] of Object.entries(next)) if (s.status !== 'saved') unsaved[id] = s;
  writeJson(STORAGE_KEYS.pending, unsaved);
}

export function upsertSubmission(matchId: string, patch: Partial<Submission> & { record?: MatchRecord }): void {
  const current = outboxStore.get();
  const prev = current[matchId];
  if (!prev && !patch.record) return;
  const next: Outbox = {
    ...current,
    [matchId]: {
      record: patch.record ?? prev!.record,
      status: patch.status ?? prev?.status ?? 'pending',
      attempts: patch.attempts ?? prev?.attempts ?? 0,
      lastError: patch.lastError !== undefined ? patch.lastError : (prev?.lastError ?? null),
    },
  };
  persist(next);
  outboxStore.set(next);
}

export function unsentSubmissions(): Submission[] {
  return Object.values(outboxStore.get()).filter((s) => s.status !== 'saved');
}
