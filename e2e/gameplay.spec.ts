import { advance, expect, hold, playUntilEnd, snapshot, startMatch, test, trackErrors, clickPlay } from './helpers';

// Arena constants mirrored from src/game/arena.ts and src/game/config.ts.
const ARENA = { width: 1600, height: 960 };
const PLAYER_RADIUS = 26;
const CENTER_ISLAND_LEFT = 10 * 64 + 6; // grass island collider left edge

test.describe('Movement and collisions', () => {
  test('moves forward, rotates both ways @smoke', async ({ page, setup }) => {
    const errors = trackErrors(page);
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    const start = await snapshot(page);
    expect(start.player.speed).toBe(0);

    const moved = await hold(page, ['KeyW'], 1000);
    expect(moved.player.x).toBeGreaterThan(start.player.x + 60); // heading right (angle π/2)

    const right = await hold(page, ['KeyD'], 500);
    expect(right.player.angle).toBeGreaterThan(moved.player.angle);
    const left = await hold(page, ['ArrowLeft'], 1000);
    expect(left.player.angle).toBeLessThan(right.player.angle);

    // Releasing input decelerates the ship to a stop (frame-rate independent).
    const stopped = await advance(page, 2000);
    expect(stopped.player.speed).toBe(0);
    expect(errors).toEqual([]);
  });

  test('cannot leave the arena', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    // Turn to face left (π/2 → −π/2) and sail into the west wall.
    await hold(page, ['KeyA'], 1310);
    const s = await hold(page, ['KeyW'], 4000);
    expect(s.player.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.01);
    expect(s.player.x).toBeLessThan(PLAYER_RADIUS + 2);
    expect(s.player.y).toBeGreaterThan(0);
    expect(s.player.y).toBeLessThan(ARENA.height);
  });

  test('islands block the ship', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    // Sail straight east into the central island.
    const s = await hold(page, ['KeyW'], 5000);
    expect(s.player.x).toBeLessThanOrEqual(CENTER_ISLAND_LEFT - PLAYER_RADIUS + 1);
    expect(s.player.x).toBeGreaterThan(CENTER_ISLAND_LEFT - PLAYER_RADIUS - 40);
  });
});

test.describe('Combat', () => {
  test('front and side cannons respect cooldowns @smoke', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    // Front cannon: one projectile per shot; 0.45 s cooldown → shots at 0, .45, .9 within 1 s.
    const front = await hold(page, ['Space'], 1000);
    expect(front.shotsFired).toBe(3);

    await advance(page, 2000); // let projectiles expire and cooldowns reset
    const before = await snapshot(page);
    expect(before.projectiles).toBe(0);

    // Side broadside: three parallel projectiles per side.
    const left = await hold(page, ['KeyQ'], 50);
    expect(left.shotsFired - before.shotsFired).toBe(3);
    expect(left.projectiles).toBe(3);
    // Holding through the 1.4 s cooldown fires nothing more.
    const held = await hold(page, ['KeyQ'], 1000);
    expect(held.shotsFired).toBe(left.shotsFired);
    // The other side has its own cooldown.
    const right = await hold(page, ['KeyE'], 50);
    expect(right.shotsFired - held.shotsFired).toBe(3);
  });

  test('kills score once and the HUD matches the simulation @smoke', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 1 } });
    await startMatch(page, 11);
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyE');
    await page.keyboard.down('KeyD');
    let s = await snapshot(page);
    for (let i = 0; i < 40 && s.phase === 'running' && s.score < 1; i++) s = await advance(page, 500);
    for (const k of ['Space', 'KeyQ', 'KeyE', 'KeyD']) await page.keyboard.up(k);
    expect(s.score).toBeGreaterThan(0);
    const spawned = s.spawned.chaser + s.spawned.shooter;
    expect(s.score).toBeLessThanOrEqual(spawned - s.enemies.length);
    await expect(page.getByTestId('hud-score')).toHaveText(String(s.score));
    // Enemies that are dead no longer exist in the simulation.
    expect(s.enemies.every((e) => e.hp > 0)).toBe(true);
  });
});

test.describe('Enemies', () => {
  test('both types spawn on the configured interval, away from the player', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 2 } });
    await startMatch(page);
    // First spawn at 1.5 s, then every 2 s.
    let s = await advance(page, 1400);
    expect(s.spawned.chaser + s.spawned.shooter).toBe(0);
    s = await advance(page, 200);
    expect(s.spawned).toEqual({ chaser: 1, shooter: 0 });
    const first = s.enemies[0]!;
    expect(Math.hypot(first.x - s.player.x, first.y - s.player.y)).toBeGreaterThanOrEqual(420);
    s = await advance(page, 2000);
    expect(s.spawned).toEqual({ chaser: 1, shooter: 1 });
    s = await advance(page, 2000);
    expect(s.spawned.chaser + s.spawned.shooter).toBe(3);
  });

  test('chaser pursues and rams; shooter keeps distance and fires', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    let s = await advance(page, 1600);
    const chaser = s.enemies.find((e) => e.kind === 'chaser')!;
    const d0 = Math.hypot(chaser.x - s.player.x, chaser.y - s.player.y);
    s = await advance(page, 2000);
    const c1 = s.enemies.find((e) => e.id === chaser.id);
    if (c1) expect(Math.hypot(c1.x - s.player.x, c1.y - s.player.y)).toBeLessThan(d0);

    // Wait for the ram: the chaser explodes, player loses 20 HP, no point is scored.
    for (let i = 0; i < 30 && s.enemies.some((e) => e.id === chaser.id); i++) s = await advance(page, 500);
    expect(s.enemies.some((e) => e.id === chaser.id)).toBe(false);
    expect(s.score).toBe(0);
    expect(s.player.hp).toBeLessThanOrEqual(80);

    // Shooter appears (2nd spawn) and fires when in range.
    for (let i = 0; i < 40 && !s.enemies.some((e) => e.kind === 'shooter'); i++) s = await advance(page, 500);
    const hpBefore = s.player.hp;
    for (let i = 0; i < 40 && s.player.hp === hpBefore && s.phase === 'running'; i++) s = await advance(page, 500);
    expect(s.player.hp).toBeLessThan(hpBefore);
    const shooter = s.enemies.find((e) => e.kind === 'shooter');
    if (shooter) expect(Math.hypot(shooter.x - s.player.x, shooter.y - s.player.y)).toBeLessThanOrEqual(400);
  });
});

test.describe('Match end and restart', () => {
  test('ends by time, freezes the simulation and restarts clean @smoke', async ({ page, setup }) => {
    const errors = trackErrors(page);
    await setup({ options: { sessionSeconds: 60, spawnIntervalSeconds: 10 } });
    await startMatch(page, 2);
    const s = await playUntilEnd(page, ['KeyW', 'KeyA', 'Space', 'KeyQ', 'KeyE']);
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('time_up');
    expect(s.elapsed).toBe(60);

    const frozen = await advance(page, 5000);
    expect(frozen.elapsed).toBe(60);
    expect(frozen.score).toBe(s.score);
    expect(frozen.spawned).toEqual(s.spawned);

    await expect(page.getByRole('heading', { name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('result-time')).toHaveText('01:00');

    await page.getByRole('button', { name: 'Play Again' }).click();
    await page.waitForFunction(() => !!window.__pirate && (window.__pirate.snapshot() as { elapsed: number }).elapsed === 0);
    const fresh = await snapshot(page);
    expect(fresh).toMatchObject({ phase: 'running', score: 0, elapsed: 0, projectiles: 0, enemies: [] });
    expect(fresh.player.hp).toBe(100);
    await expect(page.getByTestId('hud-time')).toHaveText('01:00');
    expect(errors).toEqual([]);
  });

  test('ends when the player is destroyed', async ({ page, setup }) => {
    await setup({ options: { sessionSeconds: 180, spawnIntervalSeconds: 0.5 } });
    await startMatch(page);
    const s = await playUntilEnd(page);
    expect(s.endReason).toBe('destroyed');
    expect(s.player.hp).toBe(0);
    expect(s.elapsed).toBeLessThan(180);
    await expect(page.getByRole('heading', { name: 'Ship Sunk' })).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Ship destroyed');
  });
});

test.describe('Pause', () => {
  test('manual pause freezes timer and simulation; resume needs an action @smoke', async ({ page, setup }) => {
    await setup();
    await startMatch(page);
    await advance(page, 1000);
    await page.keyboard.press('KeyP');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();

    const paused = await snapshot(page);
    // Input held during pause must not accumulate.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyJ');
    const still = await advance(page, 5000);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyJ');
    expect(still.elapsed).toBe(paused.elapsed);
    expect(still.player.x).toBe(paused.player.x);
    expect(still.shotsFired).toBe(paused.shotsFired);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const resumed = await advance(page, 500);
    expect(resumed.elapsed).toBeCloseTo(paused.elapsed + 0.5, 5);
    expect(resumed.player.speed).toBe(0);
  });

  test('pauses automatically on blur / hidden tab', async ({ page, setup }) => {
    await setup();
    await startMatch(page);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    const s = await snapshot(page);
    expect(s.pauseReason).toBe('blur');
    const later = await advance(page, 3000);
    expect(later.elapsed).toBe(s.elapsed);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await snapshot(page)).pauseReason).toBe('hidden');
  });

  test('real-time clock does not advance while paused', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await clickPlay(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    const t0 = await page.getByTestId('hud-time').textContent();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('hud-time')).toHaveText(t0!);
  });
});
