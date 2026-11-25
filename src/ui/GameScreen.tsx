import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { type GameTextures, getLoadedTextures, loadGameTextures } from '../game/assets';
import { GameController, type HudState, type MatchOutcome } from '../game/GameController';
import type { InputAction } from '../game/input';
import { createStore, useStore } from '../state/store';
import type { MatchSession } from './App';
import {Button, Dialog, Panel, RoundButton, Screen} from './components';
import { formatClock } from './format';
import { navigate } from './router';

interface Props {
  session: MatchSession;
  onEnd: (session: MatchSession, outcome: MatchOutcome) => void;
  onShowResult: () => void;
  onRestart: () => void;
}

type LoadState = { status: 'loading'; progress: number } | { status: 'error'; message: string } | { status: 'ready'; textures: GameTextures };

/** Loads textures (with progress / error / retry) before mounting the combat view. */
export function GameScreen(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<LoadState>(() => {
    const cached = getLoadedTextures();
    return cached ? { status: 'ready', textures: cached } : { status: 'loading', progress: 0 };
  });

  useEffect(() => {
    if (getLoadedTextures()) return;
    let cancelled = false;
    let failed = false;
    loadGameTextures((p) => {
      // Other textures keep finishing after a failure: never let them hide the error.
      if (!cancelled && !failed) setLoad({ status: 'loading', progress: p });
    })
      .then((textures) => {
        if (!cancelled) setLoad({ status: 'ready', textures });
      })
      .catch((e: unknown) => {
        failed = true;
        console.warn('[assets] load failed', e);
        if (!cancelled) setLoad({ status: 'error', message: 'Some game assets failed to load. Check your connection and try again.' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (load.status === 'ready') return <GameView {...props} textures={load.textures} />;

  return (
    <Screen>
      <Panel labelledBy="loading-title">
        <h1 id="loading-title" className="heading">
          {load.status === 'error' ? 'Loading failed' : 'Preparing the fleet'}
        </h1>
        {load.status === 'loading' ? (
          <div className="loading" data-testid="asset-loading">
            <progress max={100} value={Math.round(load.progress * 100)} aria-label="Loading game assets" />
            <p role="status">{Math.round(load.progress * 100)}%</p>
          </div>
        ) : (
          <div role="alert" className="state state--error" data-testid="asset-error">
            <p>{load.message}</p>
          </div>
        )}
        <div className="stack">
          {load.status === 'error' && (
            <Button
              autoFocus
              onClick={() => {
                setLoad({ status: 'loading', progress: 0 });
                setAttempt((a) => a + 1);
              }}
            >
              Retry
            </Button>
          )}
          <Button variant="secondary" small onClick={() => navigate({ name: 'menu' })}>
            Main Menu
          </Button>
        </div>
      </Panel>
    </Screen>
  );
}

declare global {
  interface Window {
    __pirate?: {
      snapshot: () => ReturnType<GameController['snapshot']>;
      advance: (ms: number) => void;
      perf: () => ReturnType<GameController['perf']>;
      manualClock: boolean;
    };
  }
}

function GameView({ session, onEnd, onShowResult, onRestart, textures }: Props & { textures: GameTextures }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GameController | null>(null);
  const hudStore = useMemo(() => createStore<HudState | null>(null), []);
  const callbacks = useRef({ onEnd, onShowResult });
  useEffect(() => {
    callbacks.current = { onEnd, onShowResult };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const manualClock = new URLSearchParams(window.location.search).get('testClock') === '1';
    const controller = new GameController({
      host,
      config: session.config,
      seed: session.seed,
      textures,
      manualClock,
      soundEnabled: session.options.soundEnabled,
      onHud: (hud) => hudStore.set(hud),
      onEnd: (outcome) => callbacks.current.onEnd(session, outcome),
      onShowResult: () => callbacks.current.onShowResult(),
    });
    controllerRef.current = controller;
    host.focus();
    controller
      .init()
      .then(() => {
        if (controllerRef.current !== controller) return;
        window.__pirate = {
          snapshot: () => controller.snapshot(),
          advance: (ms) => controller.advance(ms),
          perf: () => controller.perf(),
          manualClock,
        };
      })
      .catch((e: unknown) => console.error('[game] failed to start', e));
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
      delete window.__pirate;
    };
  }, [session, textures, hudStore]);

  const hud = useStore(hudStore);
  const touchDevice = useTouchDevice();
  const resume = useCallback(() => {
    controllerRef.current?.resume();
    // Give focus back to the arena (not the pause button) once the dialog has closed.
    window.setTimeout(() => hostRef.current?.focus(), 0);
  }, []);
  const setTouch = useCallback((a: InputAction, pressed: boolean) => controllerRef.current?.setTouch(a, pressed), []);

  return (
    <div className="game">
      <div ref={hostRef} className="game__canvas" tabIndex={-1} aria-label="Battle arena" role="application" />
      {hud && <Hud hud={hud} onPause={() => controllerRef.current?.pause('manual')} />}
      {hud && <LiveAnnouncer hud={hud} />}
      {touchDevice && hud?.phase === 'running' && !hud.paused && <TouchControls onTouch={setTouch} />}
      {hud?.paused && (
        <Dialog id="pause" title="Paused" onEscape={resume}>
          <p className="hint">
            {hud.pauseReason === 'manual' ? 'The battle is on hold.' : 'The game paused because the window lost focus.'}
          </p>
          <div className="stack">
            <Button onClick={resume}>Resume</Button>
            <Button onClick={onRestart}>Restart</Button>
            <Button variant="secondary" small onClick={() => navigate({ name: 'menu' })}>
              Main Menu
            </Button>
          </div>
          <p className="hint">Leaving or restarting abandons this battle; it will not be recorded.</p>
        </Dialog>
      )}
      <div className="rotate-hint" role="note">
        <p>Rotate your device to landscape to play.</p>
      </div>
    </div>
  );
}

function Hud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  const ratio = Math.max(0, hud.hp / hud.maxHp);
  const fill = ratio > 0.5 ? 'green' : ratio > 0.25 ? 'amber' : 'red';
  return (
    <div className="hud" data-testid="hud">
      <div className="hud__health">
        <span className="icon icon--heart" aria-hidden="true" />
        <div className="hud__bar" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={hud.maxHp} aria-valuenow={hud.hp}>
          <span className={`hud__fill hud__fill--${fill}`} style={{ width: `calc(${ratio} * 196 / 256 * 100%)` }} />
          <span className="hud__bar-text" data-testid="hud-health">
            {hud.hp} / {hud.maxHp}
          </span>
        </div>
      </div>
      <div className="hud__right">
        <div className="counter" aria-label="Score">
          <span className="icon icon--score" aria-hidden="true" />
          <span data-testid="hud-score">{hud.score}</span>
        </div>
        <div className="counter" aria-label="Time left">
          <span className="icon icon--time" aria-hidden="true" />
          <span data-testid="hud-time">{formatClock(hud.secondsLeft)}</span>
        </div>
        <RoundButton icon="pause" label="Pause" onClick={onPause} disabled={hud.paused || hud.phase !== 'running'} />
      </div>
    </div>
  );
}

/** Polite screen-reader updates on meaningful changes only (never per frame). */
function LiveAnnouncer({ hud }: { hud: HudState }) {
  const [message, setMessage] = useState('');
  const prev = useRef<HudState | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = hud;
    if (!p) {
      setMessage(`Battle started. ${hud.secondsLeft} seconds.`);
      return;
    }
    if (hud.phase === 'ended' && p.phase !== 'ended') setMessage(`Battle over. Score ${hud.score}.`);
    else if (hud.paused !== p.paused) setMessage(hud.paused ? 'Game paused.' : 'Game resumed.');
    else if (hud.score !== p.score) setMessage(`Score ${hud.score}.`);
    else if (hud.secondsLeft !== p.secondsLeft && (hud.secondsLeft % 30 === 0 || hud.secondsLeft === 10)) {
      setMessage(`${hud.secondsLeft} seconds left.`);
    } else if (hud.hp !== p.hp && hud.hp / hud.maxHp <= 0.25 && p.hp / p.maxHp > 0.25) setMessage('Health low.');
  }, [hud]);
  return (
    <div className="sr-only">
      <p role="status" aria-live="polite" data-testid="live-status">
        {message}
      </p>
      <dl>
        <dt>Score</dt>
        <dd>{hud.score}</dd>
        <dt>Time left</dt>
        <dd>{hud.secondsLeft} seconds</dd>
        <dt>Health</dt>
        <dd>
          {hud.hp} of {hud.maxHp}
        </dd>
        <dt>State</dt>
        <dd>{hud.phase === 'ended' ? 'Ended' : hud.paused ? 'Paused' : 'Playing'}</dd>
      </dl>
    </div>
  );
}

/** Touch buttons only on devices whose primary pointer is coarse (phones, tablets). */
const COARSE_POINTER = '(pointer: coarse)';
function subscribePointer(cb: () => void): () => void {
  const mq = window.matchMedia(COARSE_POINTER);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useTouchDevice(): boolean {
  return useSyncExternalStore(subscribePointer, () => window.matchMedia(COARSE_POINTER).matches);
}

const MOVE_BUTTONS: Array<{ action: InputAction; icon: string; label: string }> = [
  { action: 'turnLeft', icon: 'turn_left', label: 'Turn left' },
  { action: 'forward', icon: 'forward', label: 'Sail forward' },
  { action: 'turnRight', icon: 'turn_right', label: 'Turn right' },
];
const FIRE_BUTTONS: Array<{ action: InputAction; icon: string; label: string }> = [
  { action: 'fireLeft', icon: 'fire_left', label: 'Fire left broadside' },
  { action: 'fireFront', icon: 'fire_front', label: 'Fire bow cannon' },
  { action: 'fireRight', icon: 'fire_right', label: 'Fire right broadside' },
];

function TouchControls({ onTouch }: { onTouch: (a: InputAction, pressed: boolean) => void }) {
  const bind = (action: InputAction) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onTouch(action, true);
    },
    onPointerUp: () => onTouch(action, false),
    onPointerCancel: () => onTouch(action, false),
    onLostPointerCapture: () => onTouch(action, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <div className="touch" aria-label="Touch controls">
      <div className="touch__group touch__group--move">
        {MOVE_BUTTONS.map((b) => (
          <RoundButton key={b.action} icon={b.icon} label={b.label} tabIndex={-1} data-action={b.action} className={`touch__btn touch__btn--${b.action}`} {...bind(b.action)} />
        ))}
      </div>
      <div className="touch__group touch__group--fire">
        {FIRE_BUTTONS.map((b) => (
          <RoundButton key={b.action} icon={b.icon} label={b.label} tabIndex={-1} data-action={b.action} className={`touch__btn touch__btn--${b.action}`} {...bind(b.action)} />
        ))}
      </div>
    </div>
  );
}

