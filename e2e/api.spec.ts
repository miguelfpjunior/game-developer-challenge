import { expect, playUntilEnd, setScenario, startMatch, test } from './helpers';

test.describe('Ranking and Match History', () => {
  test('ranking paginates fixtures for the current configuration @smoke', async ({ page, setup }) => {
    await setup();
    await page.goto('/#/ranking');
    const table = page.getByTestId('ranking-table');
    await expect(table.locator('tbody tr')).toHaveCount(8);
    await expect(page.getByText('Page 1 of 5')).toBeVisible();
    await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('01');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 5')).toBeVisible();
    await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('09');
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeEnabled();

    // Keyboard tab switching.
    await page.getByRole('tab', { name: 'Ranking' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Match History' })).toHaveAttribute('aria-selected', 'true');
  });

  test('loading, empty and error states', async ({ page, setup }) => {
    await setup({ latencyMs: 0 });
    await page.goto('/#/menu');
    await setScenario(page, 'slow');
    await page.getByRole('button', { name: 'Ranking' }).click();
    await expect(page.getByText('Loading…')).toBeVisible();
    await expect(page.getByTestId('ranking-table')).toBeVisible({ timeout: 8000 });

    await setScenario(page, 'empty');
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(page.getByText('No matches yet')).toBeVisible();
    await page.getByRole('tab', { name: 'Ranking' }).click();
    await expect(page.getByText('No battles recorded with these settings yet.')).toBeVisible();

    await setScenario(page, 'history-failure');
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(page.getByRole('alert')).toContainText('History service unavailable', { timeout: 15000 });
    await setScenario(page, 'normal');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No matches yet')).toBeVisible();

    await setScenario(page, 'client-error');
    await page.getByRole('tab', { name: 'Ranking' }).click();
    // 4xx is not retried: the error shows immediately.
    await expect(page.getByRole('alert')).toContainText('Simulated missing resource', { timeout: 3000 });
  });

  test('a finished match is recorded once and both tabs refresh @smoke', async ({ page, setup }) => {
    await setup({ options: { sessionSeconds: 60, spawnIntervalSeconds: 0.5 } });
    await startMatch(page);
    const s = await playUntilEnd(page);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'saved');
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await page.getByRole('button', { name: 'Match History' }).click();
    const rows = page.getByTestId('history-table').locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('td').nth(1)).toHaveText(String(s.score));
    await page.getByRole('tab', { name: 'Ranking' }).click();
    // 60 s / 0.5 s has no fixtures: our match is the only entry.
    await expect(page.getByTestId('ranking-table').locator('tr.is-you')).toHaveCount(1);
  });

  test('pending record survives refresh and is sent after recovery', async ({ page, setup }) => {
    await setup({ options: { sessionSeconds: 60, spawnIntervalSeconds: 0.5 } });
    await page.goto('/#/menu');
    await setScenario(page, 'write-unavailable');
    await startMatch(page);
    await playUntilEnd(page);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'failed', { timeout: 15000 });

    // Starting another match while a record is pending is allowed.
    await page.getByRole('button', { name: 'Play Again' }).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.getByText('1 match waiting to sync')).toBeVisible();

    await page.reload();
    await expect(page.getByText('1 match waiting to sync')).toBeVisible({ timeout: 15000 });
    await setScenario(page, 'normal');
    await page.reload(); // outbox recovery runs on start
    await expect(page.getByText('waiting to sync')).toHaveCount(0, { timeout: 10000 });
    await page.getByRole('button', { name: 'Match History' }).click();
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(1);
  });

  test('timeout after the write is retried without duplicates', async ({ page, setup }) => {
    test.setTimeout(90_000);
    await setup({ options: { sessionSeconds: 60, spawnIntervalSeconds: 0.5 } });
    await page.goto('/#/menu');
    await setScenario(page, 'write-timeout');
    await startMatch(page);
    await playUntilEnd(page);
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'failed', { timeout: 45_000 });

    await setScenario(page, 'normal');
    // Double click must not create two records.
    const retry = page.getByRole('button', { name: 'Retry save' });
    await retry.dblclick();
    await expect(page.getByTestId('record-status')).toHaveAttribute('data-status', 'saved');
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await page.getByRole('button', { name: 'Match History' }).click();
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(1);
  });

  test('late responses do not overwrite newer data', async ({ page, setup }) => {
    await setup();
    await page.goto('/#/menu');
    await setScenario(page, 'out-of-order');
    await page.getByRole('button', { name: 'Ranking' }).click();
    await expect(page.getByTestId('ranking-table')).toBeVisible({ timeout: 8000 });
    // Alternating slow/fast answers: older requests may resolve after newer ones.
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 3 of 5')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(2500); // the slow page-2 answer arrives now
    await expect(page.getByText('Page 3 of 5')).toBeVisible();
    await expect(page.getByTestId('ranking-table').locator('tbody tr').first().locator('td').first()).toHaveText('17');
  });
});
