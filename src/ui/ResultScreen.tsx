import { useEffect, useRef } from 'react';
import { outboxStore } from '../api/pending';
import { useSubmitMatch } from '../api/queries';
import type { LastResult } from '../state/persistence';
import { useStore } from '../state/store';
import {Button, Panel, Screen} from './components';
import { formatClock, endReasonLabel } from './format';
import { navigate } from './router';

const STATUS_TEXT = {
  pending: 'Waiting to save…',
  sending: 'Saving match…',
  failed: 'Could not save this match.',
  saved: 'Match saved to ranking and history.',
} as const;

export function ResultScreen({ result, onPlayAgain }: { result: LastResult | null; onPlayAgain: () => void }) {
  const outbox = useStore(outboxStore);
  const submit = useSubmitMatch();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  if (!result) {
    return (
      <Screen>
        <Panel labelledBy="result-title">
          <h1 id="result-title" className="heading">
            No battle yet
          </h1>
          <Button onClick={() => navigate({ name: 'menu' })}>Main Menu</Button>
        </Panel>
      </Screen>
    );
  }

  const { record } = result;
  // Unsaved submissions are persisted; if it is not in the outbox after a reload, it was confirmed.
  const status = outbox[record.matchId]?.status ?? 'saved';
  const lastError = outbox[record.matchId]?.lastError;

  return (
    <Screen className="screen--result">
      <Panel labelledBy="result-title">
        <h1 id="result-title" className="heading" tabIndex={-1} ref={headingRef}>
          {record.endReason === 'time_up' ? 'Battle Complete' : 'Ship Sunk'}
        </h1>
        <p className="big-score" data-testid="result-score" aria-label={`${record.score} points`}>
          {record.score}
        </p>
        <dl className="result-meta">
          <div>
            <dt>Points</dt>
            <dd>{record.score}</dd>
          </div>
          <div>
            <dt>Time played</dt>
            <dd data-testid="result-time">{formatClock(record.durationSeconds)}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd data-testid="result-reason">{endReasonLabel(record.endReason)}</dd>
          </div>
        </dl>
        <div className={`record-status record-status--${status}`} role="status" data-testid="record-status" data-status={status}>
          <span>{STATUS_TEXT[status]}</span>
          {status === 'failed' && lastError && <span className="record-status__detail"> {lastError}</span>}
          {status === 'failed' && (
            <Button small variant="secondary" onClick={() => submit(record)}>
              Retry save
            </Button>
          )}
        </div>
        <div className="stack">
          <Button onClick={onPlayAgain}>Play Again</Button>
          <Button onClick={() => navigate({ name: 'menu' })}>Main Menu</Button>
        </div>
      </Panel>
    </Screen>
  );
}
