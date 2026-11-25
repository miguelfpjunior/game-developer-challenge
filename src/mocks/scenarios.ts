import { createRng } from '../game/math';

/**
 * Reproducible network scenarios for the mocked ranking/history API.
 * The active scenario, seed and latency are persisted in localStorage so they survive refresh
 * and can be preset by Playwright (addInitScript) or via `?scenario=<id>&mockSeed=<n>`.
 */

export const SCENARIOS = {
  normal: 'Success with normal latency',
  empty: 'Success with empty lists',
  slow: 'Slow responses (2.5 s)',
  'variable-latency': 'Seeded variable latency (0.1–2.5 s)',
  'out-of-order': 'Responses arrive out of order (older requests answer last)',
  timeout: 'All requests hang past the client timeout',
  'network-error': 'Connection failures',
  'server-error': 'HTTP 500 on every endpoint',
  'client-error': 'HTTP 400/404 on every endpoint',
  'ranking-failure': 'Ranking endpoint fails (500); history works',
  'history-failure': 'History endpoint fails (500); ranking works',
  'write-timeout': 'Match is saved, but the response times out (retry must not duplicate)',
  'write-unavailable': 'Saving a match returns 503 until the scenario changes',
} as const;

export type ScenarioId = keyof typeof SCENARIOS;

const KEYS = {
  scenario: 'pb.mock.scenario',
  seed: 'pb.mock.seed',
  latency: 'pb.mock.latencyMs',
} as const;

/** Must be larger than the Axios timeout so "timeout" scenarios really time out. */
export const HANG_MS = 9000;

export function isScenario(v: string | null): v is ScenarioId {
  return !!v && v in SCENARIOS;
}

export function getScenario(): ScenarioId {
  const v = safeGet(KEYS.scenario);
  return isScenario(v) ? v : 'normal';
}

export function setScenario(id: ScenarioId): void {
  safeSet(KEYS.scenario, id);
  requestCounter = 0;
  rng = createRng(getSeed());
}

export function getSeed(): number {
  const n = Number(safeGet(KEYS.seed));
  return Number.isFinite(n) && n > 0 ? n : 42;
}

export function setSeed(seed: number): void {
  safeSet(KEYS.seed, String(seed));
  rng = createRng(seed);
}

/** Base latency for "normal" responses. Tests set 0 for speed and determinism. */
export function getBaseLatency(): number {
  const n = Number(safeGet(KEYS.latency));
  return Number.isFinite(n) && safeGet(KEYS.latency) !== null ? n : 250;
}

export function setBaseLatency(ms: number): void {
  safeSet(KEYS.latency, String(ms));
}

export function resetScenarioSettings(): void {
  safeRemove(KEYS.scenario);
  safeRemove(KEYS.latency);
  safeRemove(KEYS.seed);
  requestCounter = 0;
  rng = createRng(getSeed());
}

let rng = createRng(getSeed());
let requestCounter = 0;

/** Latency for the next response under the active scenario (deterministic for a given seed). */
export function nextLatency(scenario: ScenarioId): number {
  requestCounter++;
  switch (scenario) {
    case 'slow':
      return 2500;
    case 'variable-latency':
      return Math.round(100 + rng() * 2400);
    case 'out-of-order':
      // Odd requests are slow, even ones fast: a later request answers before an earlier one.
      return requestCounter % 2 === 1 ? 1800 : 150;
    case 'timeout':
      return HANG_MS;
    default:
      return getBaseLatency();
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function safeRemove(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
