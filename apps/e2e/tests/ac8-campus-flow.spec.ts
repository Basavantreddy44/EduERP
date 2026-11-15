import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DATA_FILE, type E2EData } from '../global-setup';

const data: E2EData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const API = `${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1`;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email or mobile number', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('AC8 web end-to-end', () => {
  test.describe.configure({ mode: 'serial' }); // the viewer reads the campus the admin creates
  test('admin: login → choose institution → create campus → it appears in the list', async ({ page }) => {
    await signIn(page, data.admin.email, data.admin.password);

    // Two memberships → the app must ask which institution.
    await expect(page).toHaveURL(/\/select-institution/);
    await expect(page.getByRole('heading', { name: 'Choose institution' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(data.tenantB.name) })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(data.tenantA.name) }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(data.tenantA.name).first()).toBeVisible();

    await page.getByRole('navigation').getByRole('link', { name: 'Campuses', exact: true }).click();
    await expect(page).toHaveURL(/\/campuses/);
    await page.getByRole('button', { name: 'Add campus' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add campus' });
    await dialog.getByLabel('Code', { exact: true }).fill('e2e-main'); // lower-case on purpose: stored upper-case
    await dialog.getByLabel('Name (English)', { exact: true }).fill('E2E Main Campus');
    await dialog.getByLabel('City', { exact: true }).fill('Bengaluru');
    await dialog.getByRole('button', { name: 'Save campus' }).click();

    const row = page.getByRole('row', { name: /E2E-MAIN/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('E2E Main Campus');
    await expect(row).toContainText('Bengaluru');

    // Survives a reload (session restored from the refresh cookie, data from the API).
    await page.reload();
    await expect(page.getByRole('row', { name: /E2E-MAIN/ })).toBeVisible();
  });

  test('viewer without org.campus.create: no Add button, and the API refuses with 403', async ({ page, request }) => {
    await signIn(page, data.viewer.email, data.viewer.password);

    // Single membership → straight in.
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('navigation').getByRole('link', { name: 'Campuses', exact: true }).click();
    await expect(page).toHaveURL(/\/campuses/);
    await expect(page.getByRole('row', { name: /E2E-MAIN/ })).toBeVisible(); // can read
    await expect(page.getByRole('button', { name: 'Add campus' })).toHaveCount(0);

    // Bypass the UI: call the API directly with the viewer's own token.
    const login = await request.post(`${API}/auth/login`, { data: { identifier: data.viewer.email, password: data.viewer.password } });
    expect(login.status()).toBe(200);
    const { accessToken } = await login.json();
    const res = await request.post(`${API}/campuses`, {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { code: 'HACK', name: 'Should not exist', campusType: 'SCHOOL' },
    });
    expect(res.status()).toBe(403);
    expect(res.headers()['content-type']).toContain('application/problem+json');
  });
});
