import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Local runs read the repo-root .env; CI provides the variables directly.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const CI = !!process.env.CI;
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3100';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const root = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  // The Next dev server compiles pages on first visit and shares the DB with other work: allow 15 s per expectation.
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reuse servers already running locally; CI starts the built apps.
  webServer: [
    {
      command: 'pnpm --filter @eduerp/api start',
      cwd: root,
      url: `${API_URL}/api/v1/health/ready`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: CI ? 'pnpm --filter @eduerp/web start' : 'pnpm --filter @eduerp/web dev',
      cwd: root,
      url: `${WEB_URL}/login`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
});
