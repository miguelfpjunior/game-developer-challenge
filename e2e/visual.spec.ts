import { advance, expect, startMatch, test } from './helpers';

test.describe('Visual regression', () => {
  test('main menu @smoke', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page).toHaveScreenshot('menu.png');
  });

  test('arena in a stable state @smoke', async ({ page, setup }) => {
    await setup({ options: { spawnIntervalSeconds: 10 } });
    await startMatch(page, 5);
    await advance(page, 1000); // before the first spawn: deterministic scene
    await expect(page).toHaveScreenshot('arena.png');
  });

  test('result screen @smoke', async ({ page, setup }) => {
    await setup();
    await page.addInitScript(() => {
      localStorage.setItem(
        'pb.lastResult.v1',
        JSON.stringify({
          record: {
            matchId: 'visual-1',
            playerId: 'p',
            playerName: 'Tester',
            playedAt: '2026-01-01T12:00:00.000Z',
            score: 24,
            durationSeconds: 120,
            endReason: 'time_up',
            config: { sessionSeconds: 120, spawnIntervalSeconds: 3, configKey: 't120-s3' },
          },
        }),
      );
    });
    await page.goto('/#/result');
    await expect(page.getByTestId('result-score')).toHaveText('24');
    await expect(page).toHaveScreenshot('result.png');
  });
});
