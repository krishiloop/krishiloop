import { defineConfig } from '@playwright/test';

/**
 * Smoke tests for the experiences (landing, farmer app, verifier, officer, area trust). The API is mocked with page.route,
 * so no backend is needed: only the dev server (started here unless one is already running on the port).
 * Chrome is used through `channel: 'chrome'` (same as scripts/screens.mjs), so no browser download is needed.
 * E2E_PORT picks another port (the default is 5173) when that one is taken: `E2E_PORT=5183 npx playwright test`.
 */
const port = Number(process.env.E2E_PORT ?? 5173);
const base = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { baseURL: base, channel: 'chrome', headless: true, launchOptions: { args: ['--ignore-gpu-blocklist'] } },
  webServer: { command: port === 5173 ? 'npm run dev' : `npx vite --port ${port} --strictPort`, url: base, reuseExistingServer: true, timeout: 120_000 },
});
