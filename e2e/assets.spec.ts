import { expect, test, trackErrors, clickPlay } from './helpers';

test.describe('Asset loading', () => {
  // Without the MSW Service Worker, page.route() sees every texture request.
  // (Ranking/history are not needed here; the game must work even if mocks are unavailable.)
  test.use({ serviceWorkers: 'block' });
  test('shows progress, reports a failure and recovers on retry @smoke', async ({ page, setup }) => {
    const errors = trackErrors(page);
    await setup();
    let failNext = true;
    await page.route(/ship_3[-.].*png/, async (route) => {
      if (failNext) {
        failNext = false;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    // Slow every other texture down so the progress state is observable.
    await page.route(/\/tile_.*\.png/, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });

    await page.goto('/?testClock=1#/menu');
    await clickPlay(page);
    await expect(page.getByTestId('asset-loading')).toBeVisible();
    await expect(page.getByTestId('asset-error')).toBeVisible();
    await expect(page.getByTestId('asset-error')).toContainText('failed to load');

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.waitForFunction(() => !!window.__pirate);
    expect(errors.filter((e) => !/assets\] load failed/.test(e))).toEqual([]);
  });

  test('textures are reused across matches (no reload)', async ({ page, setup }) => {
    await setup();
    await page.goto('/?testClock=1#/menu');
    await clickPlay(page);
    await expect(page.getByTestId('hud')).toBeVisible();
    let textureRequests = 0;
    page.on('request', (r) => {
      if (/ship_\d+.*\.png/.test(r.url())) textureRequests++;
    });
    await page.keyboard.press('KeyP');
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('asset-loading')).toHaveCount(0);
    expect(textureRequests).toBe(0);
  });
});
