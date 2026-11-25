import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { createQueryClient, useOutboxRecovery, useSubmitMatch } from '../api/queries';
import type { MatchRecord } from '../api/contracts';
import { configKey, createConfigSnapshot, type GameConfig, type PlayerOptions } from '../game/config';
import type { MatchOutcome } from '../game/GameController';
import { getPlayerId, loadLastResult, loadOptions, saveLastResult, saveOptions } from '../state/persistence';
import { GameScreen } from './GameScreen';
import { LogScreen } from './LogScreen';
import { MainMenu } from './MainMenu';
import { OptionsScreen } from './OptionsScreen';
import { ResultScreen } from './ResultScreen';
import { navigate, parseHash, useHash } from './router';

export interface MatchSession {
  matchId: string;
  seed: number;
  config: GameConfig;
  options: PlayerOptions;
}

function newSession(options: PlayerOptions): MatchSession {
  const params = new URLSearchParams(window.location.search);
  const seedParam = Number(params.get('seed'));
  return {
    matchId: crypto.randomUUID(),
    seed: seedParam > 0 ? seedParam : Math.floor(Math.random() * 2 ** 31),
    // Snapshot: later option changes only affect new matches.
    config: createConfigSnapshot(options),
    options: { ...options },
  };
}

function Screens() {
  const route = parseHash(useHash());
  const [options, setOptions] = useState<PlayerOptions>(loadOptions);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [lastResult, setLastResult] = useState(loadLastResult);
  const [playerId] = useState(getPlayerId);
  const submit = useSubmitMatch();
  useOutboxRecovery();

  const startMatch = useCallback(() => {
    setSession(newSession(options));
    navigate({ name: 'play' });
  }, [options]);

  // Refreshing on /play abandons the match: there is no session to resume.
  useEffect(() => {
    if (route.name === 'play' && !session) navigate({ name: 'menu' }, true);
  }, [route.name, session]);

  // Leaving the combat screen (menu, result, browser back) ends the match for good.
  useEffect(() => {
    const onRouteChange = () => {
      if (parseHash(window.location.hash).name !== 'play') setSession(null);
    };
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, []);

  const handleEnd = useCallback(
    (s: MatchSession, outcome: MatchOutcome) => {
      const record: MatchRecord = {
        matchId: s.matchId,
        playerId,
        playerName: s.options.playerName,
        playedAt: new Date().toISOString(),
        score: outcome.score,
        durationSeconds: outcome.durationSeconds,
        endReason: outcome.reason,
        config: {
          sessionSeconds: s.options.sessionSeconds,
          spawnIntervalSeconds: s.options.spawnIntervalSeconds,
          configKey: configKey(s.options),
        },
      };
      const result = { record };
      saveLastResult(result);
      setLastResult(result);
      submit(record);
    },
    [playerId, submit],
  );

  const saveOpts = useCallback((next: PlayerOptions) => {
    saveOptions(next);
    setOptions(next);
  }, []);

  switch (route.name) {
    case 'options':
      return <OptionsScreen options={options} onSave={saveOpts} />;
    case 'play':
      return session ? (
        <GameScreen
          key={session.matchId}
          session={session}
          onEnd={handleEnd}
          onShowResult={() => navigate({ name: 'result' }, true)}
          onRestart={startMatch}
        />
      ) : null;
    case 'result':
      return <ResultScreen result={lastResult} onPlayAgain={startMatch} />;
    case 'log':
      return <LogScreen tab={route.tab} playerId={playerId} options={options} />;
    default:
      return <MainMenu onPlay={startMatch} />;
  }
}

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Screens />
    </QueryClientProvider>
  );
}
