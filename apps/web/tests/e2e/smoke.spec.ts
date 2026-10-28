import { expect, test, type Page } from '@playwright/test';
import { RECEIPT_ID, SID, mockApi } from './mockApi';

/**
 * Smoke test of the four experiences against a MOCKED API v0.4.0 (tests/e2e/mockApi.ts). No backend is needed.
 * It also pins the contract rules: sandbox calls only, no admin token on the wire, verify rendered from its own answer,
 * no "correct" in the verifier, and Bangla that fits a phone screen.
 */
const noOverflow = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('kl.mode', 'lite'); // no WebGL needed
    } catch {
      /* ignore */
    }
  });
});

test('landing: the story opens and says what it is', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/?mode=lite');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('receipt');
  await expect(page.getByTestId('hero-receipt')).toBeVisible();
  // the story page uses the official plan, never a sandbox
  expect(calls.paths.some((p) => p === 'POST /api/demo/session')).toBe(false);
  await noOverflow(page);
});

test('farmer app: a sandbox plan, data as-of, weather risk with its basis, no admin token', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/app?mode=lite');
  await expect(page.getByTestId('signal-word')).toBeVisible();
  await expect(page.getByTestId('data-as-of').first()).toContainText('Weather data as of');
  await expect(page.getByTestId('data-as-of').first()).toContainText('(live)');
  await expect(page.getByTestId('weather')).toBeVisible();
  await expect(page.locator('.day-risk[data-risk="high"]').first()).toBeAttached();
  await expect(page.getByTestId('risk-basis')).toContainText('team-set thresholds');
  expect(calls.paths).toContain('POST /api/demo/session');
  expect(calls.paths).toContain(`POST /api/demo/${SID}/plan`);
  expect(calls.paths.some((p) => p.startsWith('GET /api/snapshots/'))).toBe(true);
  expect(calls.headers.every((h) => !('x-admin-token' in h))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('kl.demo.sid'))).toBe(SID);
  await expect(page.getByTestId('pack-line')).toContainText('pack-potato-late-blight');
  await noOverflow(page);
});

test('verifier: certifies the advice, shows sandbox, recalls inside the sandbox only', async ({ page }) => {
  await page.addInitScript((sid) => sessionStorage.setItem('kl.demo.sid', sid), SID);
  const calls = await mockApi(page);
  await page.goto(`/verify/${RECEIPT_ID}?mode=lite`);
  await expect(page.getByTestId('verdict-word')).toHaveText('Authentic');
  await expect(page.getByTestId('certifies')).toContainText('This receipt certifies the advice:');
  await expect(page.getByTestId('certifies-title')).not.toBeEmpty();
  await expect(page.getByTestId('certifies-decision')).toBeVisible();
  await expect(page.getByTestId('certifies-window')).toContainText('Plan window');
  await expect(page.getByTestId('badge-sandbox')).toBeVisible();
  await expect(page.getByTestId('sandbox-note')).toContainText('Demo sandbox: your recall affects only your session.');
  // the page is drawn from the verify answer alone: nothing is fetched from /api/credentials for display
  // (React StrictMode runs the effect twice in dev, so the verify call itself may appear twice)
  expect(calls.paths.some((p) => p.startsWith('GET /api/verify/'))).toBe(true);
  expect(calls.paths.some((p) => p.includes('/api/credentials'))).toBe(false);
  expect(await page.locator('body').innerText()).not.toMatch(/\bcorrect\b/i);

  await page.getByTestId('recall-button').click();
  await expect(page.getByTestId('verdict-word')).toHaveText('Recalled', { timeout: 15_000 });
  expect(calls.paths).toContain(`POST /api/demo/${SID}/recall`);
  expect(calls.paths.some((p) => p === 'POST /api/admin/recall')).toBe(false);
  expect(calls.headers.every((h) => !('x-admin-token' in h))).toBe(true);
  await noOverflow(page);
});

test('verifier: an unknown id is "cannot verify", never a crash', async ({ page }) => {
  await mockApi(page);
  await page.goto('/verify/00000000-0000-4000-8000-000000000000?mode=lite');
  await expect(page.getByTestId('verdict-word')).toHaveText('Cannot verify');
});

test('officer: the demo inbox shows the session cases with their details', async ({ page }) => {
  const calls = await mockApi(page);
  await page.addInitScript((sid) => sessionStorage.setItem('kl.demo.sid', sid), SID);
  await page.goto('/officer/inbox-0123456789ab?mode=lite');
  await expect(page.getByTestId('officer-demo-badge')).toBeVisible();
  await expect(page.getByTestId('case-detail')).toContainText('inbox-0123456789ab');
  await expect(page.getByTestId('case-details')).toContainText('uncalibrated');
  expect(calls.paths).toContain(`GET /api/demo/${SID}/inbox`);
  await noOverflow(page);
});

test.describe('Bangla at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, path] of [
    ['landing', '/?mode=lite&lang=bn'],
    ['farmer app', '/app?mode=lite&lang=bn'],
    ['verifier', `/verify/${RECEIPT_ID}?mode=lite&lang=bn`],
    ['officer', '/officer?mode=lite&lang=bn'],
  ] as const) {
    test(`${name} is Bangla and does not overflow`, async ({ page }) => {
      await page.addInitScript((sid) => sessionStorage.setItem('kl.demo.sid', sid), SID);
      await mockApi(page);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
      await page.waitForTimeout(2500);
      await noOverflow(page);
      // Bangla letters on screen, and no English UI label left from the dictionary keys
      const text = await page.locator('main').innerText();
      expect(text).toMatch(/[ঀ-৿]/);
      expect(text).not.toMatch(/\b(nav|app|verify|officer|photo|signal|weather)\.[a-z_]+\b/);
    });
  }
});
