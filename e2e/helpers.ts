import { expect, type Page, test as base } from '@playwright/test';

export interface Snapshot {
  phase: 'running' | 'ended';
  elapsed: number;
  timeLeft: number;
  score: number;
  endReason: 'time_up' | 'destroyed' | null;
  paused: boolean;
  pauseReason: string | null;
  player: { x: number; y: number; angle: number; hp: number; maxHp: number; speed: number };
  enemies: Array<{ id: number; kind: 'chaser' | 'shooter'; x: number; y: number; angle: number; hp: number; maxHp: number }>;
  projectiles: number;
  spawned: { chaser: number; shooter: number };
  shotsFired: number;
}

interface Setup {
  /** Options preset in localStorage before the app boots. */
  options?: { sessionSeconds?: number; spawnIntervalSeconds?: number; playerName?: string };
  /** Mock API latency in ms (default 0 for speed and determinism). */
  latencyMs?: number;
}

/**
 * Each test gets a fresh browser context (isolated localStorage / service worker).
 * Sound is off and mock latency is 0 unless a test overrides it.
 */
export const test = base.extend<{ setup: (s?: Setup) => Promise<void> }>({
  setup: async ({ page }, use) => {
    await use(async (s: Setup = {}) => {
      const options = { sessionSeconds: 120, spawnIntervalSeconds: 3, playerName: 'Tester', soundEnabled: false, ...s.options };
      await page.addInitScript(
        ({ options, latency }) => {
          if (!sessionStorage.getItem('__e2e_init')) {
            sessionStorage.setItem('__e2e_init', '1');
            localStorage.setItem('pb.options.v1', JSON.stringify(options));
            localStorage.setItem('pb.mock.latencyMs', String(latency));
          }
        },
        { options, latency: s.latencyMs ?? 0 },
      );
    });
  },
});

export { expect };

/** Fail the test on unhandled page errors. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|status of 5\d\d|status of 4\d\d/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Main menu → Play → confirm the controls briefing (OK). */
export async function clickPlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const briefing = page.getByRole('dialog', { name: 'How to Play' });
  await expect(briefing).toBeVisible();
  await briefing.getByRole('button', { name: 'OK' }).click();
}

/** Start a match with the deterministic manual clock. */
export async function startMatch(page: Page, seed = 7): Promise<void> {
  await page.goto(`/?testClock=1&seed=${seed}#/menu`);
  await clickPlay(page);
  // Software WebGL under parallel load can be slow to start: allow more time than usual.
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__pirate);
}

export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => window.__pirate!.snapshot() as unknown as Snapshot);
}

export async function advance(page: Page, ms: number): Promise<Snapshot> {
  return page.evaluate((t) => {
    window.__pirate!.advance(t);
    return window.__pirate!.snapshot() as unknown as Snapshot;
  }, ms);
}

/** Hold real keyboard keys while the simulation advances `ms`. */
export async function hold(page: Page, keys: string[], ms: number): Promise<Snapshot> {
  for (const k of keys) await page.keyboard.down(k);
  const s = await advance(page, ms);
  for (const k of keys) await page.keyboard.up(k);
  return s;
}

/** Advance until the match ends (or a cap is reached). */
export async function playUntilEnd(page: Page, keys: string[] = [], capSeconds = 200): Promise<Snapshot> {
  for (const k of keys) await page.keyboard.down(k);
  let s = await snapshot(page);
  // Big chunks for speed, but stop exactly at the time limit so the result screen
  // (shown 1.2 s of game-clock after the end) has not opened yet when this returns.
  for (let i = 0; i < capSeconds && s.phase !== 'ended'; i++) {
    s = await advance(page, Math.min(5000, Math.ceil(s.timeLeft * 1000) + 20));
  }
  for (const k of keys) await page.keyboard.up(k);
  return s;
}

export async function setScenario(page: Page, scenario: string): Promise<void> {
  await page.evaluate((s) => (window as unknown as { __mock: { setScenario: (x: string) => void } }).__mock.setScenario(s), scenario);
}

declare global {
  interface Window {
    __pirate?: { snapshot: () => unknown; advance: (ms: number) => void; perf: () => unknown; manualClock: boolean };
  }
}
