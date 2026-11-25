import { expect, test, trackErrors, clickPlay } from './helpers';

test.describe('Options', () => {
  test('navigates, validates and persists options after refresh @smoke', async ({ page, setup }) => {
    const errors = trackErrors(page);
    await setup();
    await page.goto('/');
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();

    const session = page.getByLabel('Game session time (seconds)');
    const spawn = page.getByLabel('Enemy spawn time (seconds)');

    // Out of range values are rejected with accessible messages.
    await session.fill('59');
    await spawn.fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Must be between 60 and 180 seconds.')).toBeVisible();
    await expect(page.getByText('Must be between 0.5 and 10 seconds.')).toBeVisible();
    await expect(session).toHaveAttribute('aria-invalid', 'true');
    await expect(session).toBeFocused();

    await session.fill('181');
    await spawn.fill('-1');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Must be between 60 and 180 seconds.')).toBeVisible();

    await session.fill('90');
    await spawn.fill('1.5');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Options saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Game session time (seconds)')).toHaveValue('90');
    await expect(page.getByLabel('Enemy spawn time (seconds)')).toHaveValue('1.5');

    // A new match uses the saved session time.
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await clickPlay(page);
    await expect(page.getByTestId('hud-time')).toHaveText('01:30');
    expect(errors).toEqual([]);
  });

  test('menu is keyboard navigable with visible focus', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  });
});
