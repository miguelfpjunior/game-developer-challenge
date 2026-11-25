import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { expect, test, clickPlay } from './helpers';

/**
 * Performance profiling (run with `npm run perf`, uses the optimized build).
 * 1. A real-time 3-minute match with an autopilot (turning + firing) recording FPS,
 *    p95 frame time and entity count.
 * 2. Heap usage after 5 start/play/exit cycles (forced GC between samples).
 */
test('3-minute match frame timing and memory over 5 cycles @perf', async ({ page, setup, browserName }) => {
  const matchSeconds = Number(process.env.PERF_MATCH_SECONDS ?? 180);
  await setup({ options: { sessionSeconds: 180, spawnIntervalSeconds: 3 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heapMb = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    return Math.round((usedSize / 1048576) * 10) / 10;
  };

  // Real-time play. If the autopilot ship sinks before the time is up, a new match starts
  // (Play Again) and sampling continues, so the run always covers `matchSeconds` of combat.
  await page.goto('/?seed=99#/menu');
  await clickPlay(page);
  const keys = ['KeyW', 'KeyD', 'Space', 'KeyQ', 'KeyE'];
  type Perf = { frames: number; avgFps: number; p95FrameMs: number; maxEntities: number };
  const matches: Perf[] = [];
  let current: Perf | null = null;
  const deadline = Date.now() + matchSeconds * 1000;
  await expect(page.getByTestId('hud')).toBeVisible();
  for (const k of keys) await page.keyboard.down(k);
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const sample = (await page.evaluate(() => window.__pirate?.perf() ?? null)) as Perf | null;
    if (sample) {
      current = sample;
      continue;
    }
    // Match ended: keep its last sample and start another one.
    if (current) matches.push(current);
    current = null;
    for (const k of keys) await page.keyboard.up(k);
    await page.getByRole('button', { name: 'Play Again' }).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    for (const k of keys) await page.keyboard.down(k);
  }
  const last = (await page.evaluate(() => window.__pirate?.perf() ?? null)) as Perf | null;
  if (last ?? current) matches.push((last ?? current)!);
  for (const k of keys) await page.keyboard.up(k);
  const totalFrames = matches.reduce((n, m) => n + m.frames, 0);
  const perf = {
    matches: matches.length,
    totalFrames,
    avgFps: Math.round((matches.reduce((n, m) => n + m.avgFps * m.frames, 0) / Math.max(1, totalFrames)) * 10) / 10,
    worstP95FrameMs: Math.max(...matches.map((m) => m.p95FrameMs)),
    maxEntities: Math.max(...matches.map((m) => m.maxEntities)),
    perMatch: matches,
  };

  const memory: number[] = [await heapMb()];
  await page.goto('/?testClock=1&seed=5#/menu');
  for (let i = 0; i < 5; i++) {
    await clickPlay(page);
    await page.waitForFunction(() => !!window.__pirate);
    await page.keyboard.down('Space');
    await page.evaluate(() => window.__pirate!.advance(30_000));
    await page.keyboard.up('Space');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    memory.push(await heapMb());
  }

  const report = {
    date: new Date().toISOString(),
    browser: `${browserName} ${page.context().browser()?.version()}`,
    viewport: page.viewportSize(),
    devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
    hardware: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1073741824), platform: `${os.platform()} ${os.release()}` },
    config: { sessionSeconds: 180, spawnIntervalSeconds: 3, seed: 99, measuredSeconds: matchSeconds },
    frameTiming: perf,
    heapAfterCyclesMb: memory,
  };
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/perf-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // Memory must not grow continuously across cycles (allow noise).
  expect(memory[memory.length - 1]! - memory[1]!).toBeLessThan(15);
});
