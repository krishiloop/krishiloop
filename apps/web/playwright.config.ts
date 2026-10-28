import { defineConfig } from '@playwright/test';

/**
 * Smoke tests for the four experiences (landing, farmer app, verifier, officer). The API is mocked with page.route, so
 * no backend is needed: only the dev server (started here unless one is already running on :5173).
 * Chrome is used through `channel: 'chrome'` (same as scripts/screens.mjs), so no browser download is needed.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true, launchOptions: { args: ['--ignore-gpu-blocklist'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120_000 },
});
