import { setupWorker } from 'msw/browser';
import { resetDb } from './db';
import { handlers } from './handlers';
import {
  type ScenarioId,
  getBaseLatency,
  getScenario,
  getSeed,
  isScenario,
  resetScenarioSettings,
  setBaseLatency,
  setScenario,
  setSeed,
} from './scenarios';

export const worker = setupWorker(...handlers);

export interface MockControls {
  getScenario: () => ScenarioId;
  setScenario: (id: ScenarioId) => void;
  setSeed: (seed: number) => void;
  setLatency: (ms: number) => void;
  /** Restore fixtures, clear scenario/seed/latency overrides. */
  reset: () => void;
  info: () => { scenario: ScenarioId; seed: number; latencyMs: number };
}

export const mockControls: MockControls = {
  getScenario,
  setScenario,
  setSeed,
  setLatency: setBaseLatency,
  reset: () => {
    resetDb();
    resetScenarioSettings();
  },
  info: () => ({ scenario: getScenario(), seed: getSeed(), latencyMs: getBaseLatency() }),
};

/** Start the worker in every environment (dev, preview, deployed build, tests). */
export async function startMocks(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario');
  if (isScenario(scenario)) setScenario(scenario);
  const seed = Number(params.get('mockSeed'));
  if (seed > 0) setSeed(seed);
  if (params.has('mockReset')) mockControls.reset();

  (window as unknown as { __mock: MockControls }).__mock = mockControls;
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
    quiet: import.meta.env.PROD,
  });
}
