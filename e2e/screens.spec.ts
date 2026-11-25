import { advance, expect, playUntilEnd, startMatch, test, trackErrors } from './helpers';

test.describe('Result and navigation', () => {
  test('result persists after refresh @smoke', async ({ page, setup }) => {
    await setup({ options: { sessionSeconds: 60, spawnIntervalSeconds: 0.5 } });
    await startMatch(page);
    const s = await playUntilEnd(page);
    await expect(page.getByTestId('result-score')).toHaveText(String(s.score));
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'saved');
    const time = await page.getByTestId('result-time').textContent();

    await page.reload();
    await expect(page.getByTestId('result-score')).toHaveText(String(s.score));
    await expect(page.getByTestId('result-time')).toHaveText(time!);
    await expect(page.getByTestId('result-reason')).toHaveText(s.endReason === 'time_up' ? 'Time up' : 'Ship destroyed');
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'saved');
  });

  test('abandoning a match records nothing; refresh on /play abandons too @smoke', async ({ page, setup }) => {
    const errors = trackErrors(page);
    await setup();
    for (let i = 0; i < 3; i++) {
      await startMatch(page);
      await advance(page, 2000);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Main Menu' }).click();
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.__pirate)).toBeUndefined();
    }
    await startMatch(page);
    await page.reload();
    await expect(page).toHaveURL(/#\/menu$/);

    await page.getByRole('button', { name: 'Match History' }).click();
    await expect(page.getByText('No matches yet')).toBeVisible();
    // Only one canvas ever exists (no leaked Pixi apps).
    expect(await page.locator('canvas').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('browser back from combat abandons the match', async ({ page, setup }) => {
    await setup();
    await startMatch(page);
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});

test.describe('Touch controls', () => {
  test('on-screen buttons move and fire @mobile-only', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    const start = await advance(page, 0);
    const forward = page.getByRole('button', { name: 'Sail forward' });
    const box = (await forward.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const moved = await advance(page, 1000);
    await page.mouse.up();
    expect(moved.player.x).toBeGreaterThan(start.player.x + 50);

    await page.getByRole('button', { name: 'Fire bow cannon' }).dispatchEvent('pointerdown', { pointerId: 1 });
    const fired = await advance(page, 50);
    await page.getByRole('button', { name: 'Fire bow cannon' }).dispatchEvent('pointerup', { pointerId: 1 });
    expect(fired.shotsFired).toBe(1);

    // HUD and controls fit the landscape viewport.
    const vp = page.viewportSize()!;
    for (const name of ['Turn left', 'Fire right broadside', 'Pause']) {
      const b = (await page.getByRole('button', { name }).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
    }
  });
});

test.describe('Play briefing and desktop layout', () => {
  test('Play shows the controls; Cancel returns, OK starts', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await expect(page.getByText('How to play')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'How to Play' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Port broadside (left)')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'OK' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#?\/?(menu)?$/);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByTestId('hud')).toBeVisible();
  });

  test('no touch buttons with a mouse (full-screen sea is covered by the arena baseline)', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page);
    await expect(page.getByRole('button', { name: 'Sail forward' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
