import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECEIPT_ID, SID, mockApi } from './mockApi';

/**
 * Screenshots of the farmer app and the verifier in English and Bangla at 390 and 1440 px, with the mocked API v0.4.0
 * (sandbox plan, data as-of, risk, certified advice, sandbox badge, recall). Skipped unless SCREENS=1:
 *   SCREENS=1 npx playwright test screens
 * Output: docs/design/screens/ (farmer-{top,full}-{en,bn}-{390,1440}.png, verify-{authentic,recalled}-{en,bn}-{390,1440}.png).
 */
const out = fileURLToPath(new URL('../../../../docs/design/screens/', import.meta.url));
const sizes = [
  { tag: '390', w: 390, h: 844, dsf: 2 },
  { tag: '1440', w: 1440, h: 900, dsf: 1 },
] as const;

test.skip(!process.env.SCREENS, 'set SCREENS=1 to retake the screenshots');
test.beforeAll(() => mkdirSync(out, { recursive: true }));

for (const { tag, w, h, dsf } of sizes) {
  for (const lang of ['en', 'bn'] as const) {
    test.describe(`${lang} ${tag}`, () => {
      test.use({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: w < 700, isMobile: w < 700, colorScheme: 'dark' });

      test('farmer app', async ({ page }) => {
        await mockApi(page);
        await page.goto(`/app?mode=lite&lang=${lang}`);
        await page.getByTestId('signal-word').waitFor();
        await page.waitForTimeout(2200);
        await page.screenshot({ path: `${out}farmer-top-${lang}-${tag}.png` });
        await page.screenshot({ path: `${out}farmer-full-${lang}-${tag}.png`, fullPage: true });
      });

      test('verifier', async ({ page }) => {
        await page.addInitScript((sid) => sessionStorage.setItem('kl.demo.sid', sid), SID);
        await mockApi(page);
        await page.goto(`/verify/${RECEIPT_ID}?mode=lite&lang=${lang}`);
        await page.getByTestId('certifies').waitFor();
        await page.waitForTimeout(3800);
        await page.screenshot({ path: `${out}verify-authentic-${lang}-${tag}.png`, fullPage: true });
        await page.getByTestId('recall-button').click();
        await page.waitForFunction(() => document.querySelector('[data-testid=verdict]')?.getAttribute('data-status') === 'recalled', null, { timeout: 15_000 });
        await page.waitForTimeout(3600);
        await page.screenshot({ path: `${out}verify-recalled-${lang}-${tag}.png`, fullPage: true });
      });
    });
  }
}
