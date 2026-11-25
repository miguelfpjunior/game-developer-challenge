import { useState, type KeyboardEvent } from 'react';
import { useHistory, useRanking } from '../api/queries';
import { toApiError } from '../api/client';
import { configKey, type PlayerOptions } from '../game/config';
import {Button, Panel, RoundButton, Screen} from './components';
import { formatClock, formatDate, endReasonLabel } from './format';
import { navigate } from './router';

type Tab = 'ranking' | 'history';

export function LogScreen({ tab, playerId, options }: { tab: Tab; playerId: string; options: PlayerOptions }) {
  const tabs: Tab[] = ['ranking', 'history'];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tab === 'ranking' ? 'history' : 'ranking';
    navigate({ name: 'log', tab: next }, true);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  return (
    <Screen className="screen--log">
      <Panel wide labelledBy="log-title">
        <h1 id="log-title" className="heading">
          Captain&apos;s Log
        </h1>
        <div className="tabs" role="tablist" aria-label="Captain's log" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              role="tab"
              type="button"
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className={`btn btn--small ${tab === t ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => navigate({ name: 'log', tab: t }, true)}
            >
              {t === 'ranking' ? 'Ranking' : 'Match History'}
            </button>
          ))}
        </div>
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="tabpanel">
          {tab === 'ranking' ? <RankingTab playerId={playerId} options={options} /> : <HistoryTab playerId={playerId} />}
        </div>
        <div className="row">
          <Button onClick={() => navigate({ name: 'menu' })}>Main Menu</Button>
        </div>
      </Panel>
    </Screen>
  );
}

function Pager({ page, totalPages, onChange, disabled }: { page: number; totalPages: number; onChange: (p: number) => void; disabled: boolean }) {
  return (
    <nav className="pager" aria-label="Pagination">
      <RoundButton icon="turn_left" label="Previous page" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} />
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <RoundButton icon="turn_right" label="Next page" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)} />
    </nav>
  );
}

function QueryState({
  isPending,
  error,
  isFetching,
  empty,
  emptyText,
  onRetry,
}: {
  isPending: boolean;
  error: unknown;
  isFetching: boolean;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
}) {
  if (isPending) return <p className="state state--loading" role="status">Loading…</p>;
  if (error) {
    return (
      <div className="state state--error" role="alert">
        <p>Could not load data: {toApiError(error).message}</p>
        <Button small variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <>
      <p className="state state--updating" role="status" aria-live="polite">
        {isFetching ? 'Updating…' : ''}
      </p>
      {empty && <p className="state state--empty">{emptyText}</p>}
    </>
  );
}

function RankingTab({ playerId, options }: { playerId: string; options: PlayerOptions }) {
  const [page, setPage] = useState(1);
  const key = configKey(options);
  const q = useRanking(key, page);
  const data = q.data;
  return (
    <div>
      <p className="caption">
        {options.sessionSeconds} second battles · {options.spawnIntervalSeconds} second spawn interval
      </p>
      <QueryState
        isPending={q.isPending}
        error={q.isError && !data ? q.error : null}
        isFetching={q.isFetching && !q.isPending}
        empty={!!data && data.items.length === 0}
        emptyText="No battles recorded with these settings yet."
        onRetry={() => void q.refetch()}
      />
      {q.isError && data && (
        <div className="state state--error" role="alert">
          <p>Refresh failed: {toApiError(q.error).message} Showing the last loaded data.</p>
          <Button small variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {data && data.items.length > 0 && (
        <table className="log-table" data-testid="ranking-table">
          <caption className="sr-only">Ranking, page {data.page}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Captain</th>
              <th scope="col">Points</th>
              <th scope="col">Duration</th>
              <th scope="col">Played</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.matchId} className={r.playerId === playerId ? 'is-you' : ''}>
                <td>{String(r.rank).padStart(2, '0')}</td>
                <td>
                  {r.playerName}
                  {r.playerId === playerId && <span className="you-badge">You</span>}
                </td>
                <td>{r.score}</td>
                <td>{formatClock(r.durationSeconds)}</td>
                <td>{formatDate(r.playedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} disabled={q.isPlaceholderData} />}
    </div>
  );
}

function HistoryTab({ playerId }: { playerId: string }) {
  const [page, setPage] = useState(1);
  const q = useHistory(playerId, page);
  const data = q.data;
  return (
    <div>
      <p className="caption">Your battles, newest first</p>
      <QueryState
        isPending={q.isPending}
        error={q.isError && !data ? q.error : null}
        isFetching={q.isFetching && !q.isPending}
        empty={!!data && data.items.length === 0}
        emptyText="No matches yet. Finish a battle to see it here."
        onRetry={() => void q.refetch()}
      />
      {q.isError && data && (
        <div className="state state--error" role="alert">
          <p>Refresh failed: {toApiError(q.error).message} Showing the last loaded data.</p>
          <Button small variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {data && data.items.length > 0 && (
        <table className="log-table" data-testid="history-table">
          <caption className="sr-only">Match history, page {data.page}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Points</th>
              <th scope="col">Duration</th>
              <th scope="col">Result</th>
              <th scope="col">Settings</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.matchId}>
                <td>{formatDate(r.playedAt)}</td>
                <td>{r.score}</td>
                <td>{formatClock(r.durationSeconds)}</td>
                <td>{endReasonLabel(r.endReason)}</td>
                <td>
                  {r.config.sessionSeconds}s / {r.config.spawnIntervalSeconds}s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} disabled={q.isPlaceholderData} />}
    </div>
  );
}
