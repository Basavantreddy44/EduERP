import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { DATA_FILE, type E2EData } from '../global-setup';

const data: E2EData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

test('AC20 language: choose ಕನ್ನಡ on the sign-in page, it carries into the app, survives reload, and can be switched back', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ಕನ್ನಡ' }).click();
  await expect(page.getByRole('heading', { name: 'ಮತ್ತೆ ಸ್ವಾಗತ' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kn');

  await page.getByLabel('ಇಮೇಲ್ ಅಥವಾ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ', { exact: true }).fill(data.viewer.email);
  await page.getByLabel('ಪಾಸ್‌ವರ್ಡ್', { exact: true }).fill(data.viewer.password);
  await page.getByRole('button', { name: 'ಸೈನ್ ಇನ್' }).click();

  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್', exact: true })).toBeVisible();
  await page.reload();
  await expect(nav.getByRole('link', { name: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್', exact: true })).toBeVisible();

  await page.locator('.user-btn').click();
  // Switching also saves the choice to the account; wait for that, so later tests see English.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/me/preferences') && r.request().method() === 'PATCH' && r.ok()),
    page.getByRole('button', { name: 'English' }).click(),
  ]);
  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
