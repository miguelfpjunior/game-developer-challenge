import { Application } from 'pixi.js';
import { sound } from './audio';
import type { GameTextures } from './assets';
import type { GameConfig } from './config';
import { type InputAction, InputManager } from './input';
import { GameRenderer } from './renderer';
import { type EndReason, type GameEvent, Simulation, type SimulationSnapshot } from './simulation';

/** Fixed simulation step (seconds). Rendering runs at display rate; sim is frame-rate independent. */
export const FIXED_STEP = 1 / 120;
const MAX_FRAME_SECONDS = 0.1;

export type PauseReason = 'manual' | 'blur' | 'hidden';

/** Coarse, React-friendly view of the match. Emitted only when a displayed value changes. */
export interface HudState {
  hp: number;
  maxHp: number;
  score: number;
  /** Whole seconds remaining (ceil). */
  secondsLeft: number;
  paused: boolean;
  pauseReason: PauseReason | null;
  phase: 'running' | 'ended';
}

export interface MatchOutcome {
  score: number;
  durationSeconds: number;
  reason: EndReason;
}

export interface GameControllerOptions {
  host: HTMLElement;
  config: GameConfig;
  seed: number;
  textures: GameTextures;
  /** Manual clock: simulation advances only through `advance()` (test instrumentation). */
  manualClock: boolean;
  soundEnabled: boolean;
  onHud: (hud: HudState) => void;
  onEnd: (outcome: MatchOutcome) => void;
  /** Called once the end-of-match effects had time to play (clock-driven, so tests stay deterministic). */
  onShowResult: () => void;
}

/** Seconds between the end of the match and the result screen. */
export const RESULT_DELAY_SECONDS = 1.2;

export interface PerfSample {
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  maxEntities: number;
  currentEntities: number;
}

/**
 * Owns the Pixi application, the simulation loop, input and pause handling for ONE match.
 * Created on mount, destroyed on unmount/restart. Safe under React Strict Mode:
 * `destroy()` may run before `init()` resolves.
 */
export class GameController {
  private readonly opts: GameControllerOptions;
  private app: Application | null = null;
  private renderer: GameRenderer | null = null;
  private sim: Simulation;
  private readonly input: InputManager;
  private resizeObserver: ResizeObserver | null = null;
  private accumulator = 0;
  private paused = false;
  private pauseReason: PauseReason | null = null;
  private destroyed = false;
  private ended = false;
  private endedFor = 0;
  private resultShown = false;
  private lastHudKey = '';
  private pendingEvents: GameEvent[] = [];
  private frameTimes: number[] = [];
  private maxEntities = 0;
  private lowHealthWarned = false;
  private timeWarned = false;

  constructor(opts: GameControllerOptions) {
    this.opts = opts;
    this.sim = new Simulation(opts.config, opts.seed);
    this.input = new InputManager(() => this.togglePause());
    sound.setEnabled(opts.soundEnabled);
  }

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      background: 0x12324a,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: Math.max(1, this.opts.host.clientWidth),
      height: Math.max(1, this.opts.host.clientHeight),
      preference: 'webgl',
    });
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    this.app = app;
    app.canvas.setAttribute('aria-hidden', 'true');
    app.canvas.dataset.testid = 'game-canvas';
    this.opts.host.appendChild(app.canvas);

    this.renderer = new GameRenderer(this.opts.textures, app.renderer);
    app.stage.addChild(this.renderer.stage);
    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.opts.host);

    this.input.attach();
    this.input.setActive(true);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('blur', this.handleBlur);

    if (this.opts.manualClock) {
      // Manual clock: nothing changes between advance() calls, so draw on demand only.
      app.ticker.stop();
      this.flushFrame(0, false);
      app.render();
    } else {
      app.ticker.add(this.tick);
    }
    this.emitHud(true);
    sound.play('game_start');
    sound.startAmbience();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('blur', this.handleBlur);
    this.input.detach();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    sound.stopAmbience();
    if (this.app) {
      this.app.ticker.remove(this.tick);
      this.renderer?.destroy();
      // Shared textures survive: only the scene graph and renderer are released.
      this.app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
    }
    this.app = null;
    this.renderer = null;
  }

  pause(reason: PauseReason): void {
    if (this.paused || this.ended || this.destroyed) return;
    this.paused = true;
    this.pauseReason = reason;
    this.accumulator = 0;
    this.input.setActive(false);
    sound.play('game_pause');
    this.emitHud(true);
  }

  resume(): void {
    if (!this.paused || this.ended || this.destroyed) return;
    this.paused = false;
    this.pauseReason = null;
    this.accumulator = 0; // never catch up on paused time
    this.input.reset();
    this.input.setActive(true);
    sound.play('game_resume');
    this.emitHud(true);
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause('manual');
  }

  setTouch(action: InputAction, pressed: boolean): void {
    this.input.setTouch(action, pressed);
  }

  /** Test instrumentation: step the real simulation by `ms` using current input. */
  advance(ms: number): void {
    if (!this.opts.manualClock) return;
    let remaining = ms / 1000;
    const wasEnded = this.ended;
    while (remaining > 1e-9 && !this.paused && !this.ended) {
      const dt = Math.min(FIXED_STEP, remaining);
      this.stepOnce(dt);
      remaining -= dt;
      if (this.sim.phase === 'ended') break;
    }
    // Visual-only animation (water, effects) follows the manual clock too, for stable screenshots.
    this.flushFrame(ms / 1000, true);
    this.app?.render();
    if (wasEnded && !this.paused) this.countEndDelay(ms / 1000);
    else if (this.ended) this.countEndDelay(remaining);
  }

  snapshot(): SimulationSnapshot & { paused: boolean; pauseReason: PauseReason | null } {
    return { ...this.sim.snapshot(), paused: this.paused, pauseReason: this.pauseReason };
  }

  perf(): PerfSample {
    const times = [...this.frameTimes].sort((a, b) => a - b);
    const avg = times.length ? times.reduce((s, t) => s + t, 0) / times.length : 0;
    return {
      frames: times.length,
      avgFps: avg ? 1000 / avg : 0,
      p95FrameMs: times.length ? times[Math.floor(times.length * 0.95)]! : 0,
      maxEntities: this.maxEntities,
      currentEntities: this.renderer?.entityCount ?? 0,
    };
  }

  // ------------------------------------------------------------------

  private readonly tick = (): void => {
    if (!this.app) return;
    const frameMs = this.app.ticker.deltaMS;
    if (!this.paused) {
      this.frameTimes.push(frameMs);
      if (this.frameTimes.length > 20000) this.frameTimes.splice(0, 10000);
    }
    const dt = Math.min(frameMs / 1000, MAX_FRAME_SECONDS);
    if (!this.opts.manualClock && !this.paused && !this.ended) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_STEP && !this.ended) {
        this.stepOnce(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    }
    const wasEnded = this.ended;
    this.flushFrame(dt, !this.paused);
    if (wasEnded) this.countEndDelay(dt);
  };

  private countEndDelay(seconds: number): void {
    if (!this.ended || this.resultShown) return;
    this.endedFor += seconds;
    if (this.endedFor >= RESULT_DELAY_SECONDS) {
      this.resultShown = true;
      this.opts.onShowResult();
    }
  }

  private stepOnce(dt: number): void {
    this.sim.step(dt, this.input.read());
    this.pendingEvents.push(...this.sim.drainEvents());
  }

  private flushFrame(dt: number, animate: boolean): void {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.renderer?.render(this.sim, events, dt, animate);
    if (this.renderer) this.maxEntities = Math.max(this.maxEntities, this.renderer.entityCount);
    this.playSounds(events);
    this.emitHud(false);
    const endEvent = events.find((e) => e.type === 'ended');
    if (endEvent && !this.ended) {
      this.ended = true;
      this.input.setActive(false);
      sound.stopAmbience();
      this.emitHud(true);
      this.opts.onEnd({
        score: this.sim.score,
        durationSeconds: Math.round(this.sim.elapsed * 1000) / 1000,
        reason: endEvent.reason,
      });
    }
  }

  private playSounds(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          sound.play(e.weapon === 'left' || e.weapon === 'right' ? 'cannon_broadside' : e.weapon === 'enemy' ? 'cannon_fire_2' : 'cannon_fire_1', e.weapon === 'enemy' ? 0.5 : 0.8);
          break;
        case 'hit':
          sound.play(e.targetKind === 'player' ? 'ship_wood_hit_1' : 'ship_wood_hit_2', 0.7);
          break;
        case 'splash':
          sound.play('cannonball_water_hit_1', 0.35);
          break;
        case 'ram':
          sound.play('ship_collision');
          break;
        case 'destroyed':
          sound.play(e.ship.kind === 'player' ? 'ship_sinking' : 'ship_explosion_1', 0.8);
          break;
        case 'score':
          sound.play('score_point', 0.6);
          break;
        case 'ended':
          sound.play(e.reason === 'time_up' ? 'game_complete' : 'game_over');
          break;
        default:
          break;
      }
    }
    const p = this.sim.player;
    if (!this.lowHealthWarned && p.hp > 0 && p.hp / p.maxHp <= 0.25) {
      this.lowHealthWarned = true;
      sound.play('health_low');
    }
    if (!this.timeWarned && this.sim.timeLeft <= 10 && this.sim.phase === 'running') {
      this.timeWarned = true;
      sound.play('time_warning');
    }
  }

  private emitHud(force: boolean): void {
    const p = this.sim.player;
    const hud: HudState = {
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      score: this.sim.score,
      secondsLeft: Math.ceil(this.sim.timeLeft),
      paused: this.paused,
      pauseReason: this.pauseReason,
      phase: this.sim.phase,
    };
    const key = `${hud.hp}|${hud.score}|${hud.secondsLeft}|${hud.paused}|${hud.pauseReason}|${hud.phase}`;
    if (!force && key === this.lastHudKey) return;
    this.lastHudKey = key;
    this.opts.onHud(hud);
  }

  private handleResize(): void {
    if (!this.app || !this.renderer) return;
    const w = Math.max(1, this.opts.host.clientWidth);
    const h = Math.max(1, this.opts.host.clientHeight);
    this.app.renderer.resize(w, h);
    this.renderer.resize(w, h);
    if (this.opts.manualClock) {
      this.flushFrame(0, false);
      this.app.render();
    }
  }

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.pause('hidden');
  };

  private readonly handleBlur = (): void => {
    this.pause('blur');
  };
}
