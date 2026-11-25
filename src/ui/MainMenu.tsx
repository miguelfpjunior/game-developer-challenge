import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { outboxStore } from '../api/pending';
import { Button, ControlsHelp, Dialog, Panel, Screen } from './components';
import { navigate } from './router';

export function MainMenu({ onPlay }: { onPlay: () => void }) {
  const outbox = useStore(outboxStore);
  const unsent = Object.values(outbox).filter((s) => s.status !== 'saved').length;
  const [briefing, setBriefing] = useState(false);
  const closeBriefing = useCallback(() => setBriefing(false), []);

  return (
    <Screen className="screen--menu">
      <Panel labelledBy="menu-title">
        <h1 id="menu-title" className="title-art">
          <span className="sr-only">Pirate Battle</span>
        </h1>
        <p className="tagline">Set sail. Take command.</p>
        <div className="stack">
          <Button onClick={() => setBriefing(true)} autoFocus>
            Play
          </Button>
          <Button onClick={() => navigate({ name: 'options' })}>Options</Button>
        </div>
        {unsent > 0 && (
          <p className="notice" role="status">
            {unsent} match{unsent > 1 ? 'es' : ''} waiting to sync with the server.
          </p>
        )}
        <nav className="row" aria-label="Captain's log">
          <Button variant="secondary" small onClick={() => navigate({ name: 'log', tab: 'ranking' })}>
            Ranking
          </Button>
          <Button variant="secondary" small onClick={() => navigate({ name: 'log', tab: 'history' })}>
            Match History
          </Button>
        </nav>
      </Panel>
      {briefing && (
        <Dialog id="briefing" title="How to Play" onEscape={closeBriefing}>
          <p className="hint">Sink enemy ships before time runs out. Each ship sunk by your cannons is worth 1 point.</p>
          <ControlsHelp />
          <div className="row">
            <Button onClick={onPlay} autoFocus>
              OK
            </Button>
            <Button variant="secondary" small onClick={closeBriefing}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </Screen>
  );
}
