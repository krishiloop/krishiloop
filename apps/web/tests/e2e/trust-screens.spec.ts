import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mockApi } from './mockApi';
import { AREA_CRED, PHOTO_RECEIPT_ID } from './trustMock';
import { bigPhoto, photoUrl, sendPhoto, withSession } from './trustHelpers';

/**
 * Screenshots of the earned-trust beat (farmer card, officer cases, the gate moment, the area trust panel, the verifier),
 * taken against the mocked API. Skipped unless SCREENS=1:
 *   E2E_PORT=5183 SCREENS=1 npx playwright test trust-screens
 * Output: docs/design/screens/trust-*.png (git-ignored). Everything on screen is a test fixture, not a measurement.
 */
const out = fileURLToPath(new URL('../../../../docs/design/screens/', import.meta.url));
test.skip(!process.env.SCREENS, 'set SCREENS=1 to retake the screenshots');
test.beforeAll(() => mkdirSync(out, { recursive: true }));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('kl.mode', 'lite');
    } catch {
      /* ignore */
    }
  });
});

const png = (name: string) => `${out}trust-${name}.png`;
const settle = (page: Page, ms = 1700) => page.waitForTimeout(ms);

/** Scroll through the page once so every scroll reveal has played, then back to the top (a full-page capture would otherwise show them hidden). */
async function revealAll(page: Page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => Math.round(window.innerHeight * 0.6));
  for (let y = 0; y < total; y += step) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/** One element, whole, even when it is taller than the phone: a full-page capture clipped to its box (no sticky header in it). */
async function shotEl(page: Page, testId: string, path: string) {
  const clip = await page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left + window.scrollX), y: r.top + window.scrollY, width: r.width, height: r.height };
  });
  await page.screenshot({ path, fullPage: true, clip });
}

for (const { tag, w, h, dsf } of [
  { tag: '390', w: 390, h: 844, dsf: 2 },
  { tag: '1440', w: 1440, h: 900, dsf: 1 },
] as const) {
  test.describe(`screens ${tag}`, () => {
    test.use({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: w < 700, isMobile: w < 700, colorScheme: 'dark' });

    for (const lang of ['en', 'bn'] as const) {
      const q = lang === 'bn' ? '&lang=bn' : '';
      const sfx = lang === 'bn' ? `-bn-${tag}` : `-${tag}`;

      test(`farmer card (${lang})`, async ({ page }) => {
        await mockApi(page, { photo: { route: 'officer', sure: true, area: 'fresh' } });
        await page.goto(photoUrl(q));
        await page.getByTestId('area-take').waitFor();
        await settle(page);
        await shotEl(page, 'photo-card', png(`farmer-idle${sfx}`));
        await page.getByTestId('area-photo-input').setInputFiles(await bigPhoto(page));
        await page.getByTestId('area-composer').waitFor();
        await page.getByTestId('area-consent').check();
        await settle(page, 500);
        await shotEl(page, 'photo-card', png(`farmer-composer${sfx}`));
        await page.getByTestId('area-send').click();
        await page.getByTestId('area-officer-title').waitFor();
        await settle(page);
        await shotEl(page, 'photo-card', png(`farmer-officer-route${sfx}`));
      });

      test(`farmer card, automatic route (${lang})`, async ({ page }) => {
        await mockApi(page, { photo: { route: 'auto' } });
        await page.goto(photoUrl(q));
        await page.getByTestId('area-take').waitFor();
        await sendPhoto(page, false);
        await page.getByTestId('area-plan').waitFor();
        await settle(page);
        await shotEl(page, 'photo-card', png(`farmer-auto-route${sfx}`));
      });

      test(`officer photo case (${lang})`, async ({ page }) => {
        await withSession(page);
        await mockApi(page, { photo: { area: 'one-away', route: 'officer', cases: [{}, {}] } });
        await page.goto(`/officer?mode=lite${q}`);
        await page.getByTestId('area-strip-chip').first().waitFor();
        await settle(page, 900);
        await page.screenshot({ path: png(`officer-list${sfx}`) });
        await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
        await page.getByTestId('pc-photo-img').waitFor();
        await settle(page, 900);
        await page.screenshot({ path: png(`officer-case${sfx}`), fullPage: true });
        await page.getByTestId('pc-else').click();
        await page.getByTestId('pc-choice-blast').click();
        await page.getByTestId('gate-moment').waitFor();
        await settle(page, 2400);
        await page.screenshot({ path: png(`officer-gate-open${sfx}`), fullPage: true });
      });
    }

    test('officer: a wrong answer, and trust withdrawn', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { area: 'drifting', route: 'officer', cases: [{}] } });
      await page.goto('/officer?mode=lite');
      await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
      await page.getByTestId('pc-photo-img').waitFor();
      await page.getByTestId('pc-else').click();
      await page.getByTestId('pc-choice-tungro').click();
      await page.getByTestId('gate-moment').waitFor();
      await settle(page, 2400);
      await page.screenshot({ path: png(`officer-gate-closed-${tag}`), fullPage: true });
    });

    for (const lang of ['en', 'bn'] as const) {
      const q = lang === 'bn' ? '&lang=bn' : '';
      const sfx = lang === 'bn' ? `-bn-${tag}` : `-${tag}`;
      test(`area trust panel (${lang})`, async ({ page }) => {
        await withSession(page);
        await mockApi(page, { photo: { replay: 'ready', area: 'fresh' } });
        await page.goto(`/trust?mode=lite${q}`);
        await page.getByTestId('replay-chart').waitFor();
        await revealAll(page);
        await settle(page, 1800);
        await page.screenshot({ path: png(`panel${sfx}`), fullPage: true });
        await page.getByTestId('replay-area-BD-A').click();
        await settle(page, 1700);
        await shotEl(page, 'replay-panel', png(`panel-never${sfx}`));
      });
    }

    test('area trust panel: sample, drift and 404', async ({ page }) => {
      await mockApi(page);
      await page.goto('/trust?sample=1&mode=lite');
      await page.getByTestId('replay-chart').waitFor();
      await page.getByTestId('replay-area-BD-E').click();
      await settle(page, 2000);
      await shotEl(page, 'replay-panel', png(`panel-sample-drift-${tag}`));
    });

    test('light theme: the panel and a gate moment', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { replay: 'ready', area: 'one-away', route: 'officer', cases: [{}] } });
      await page.goto('/trust?mode=lite&theme=light');
      await page.getByTestId('replay-chart').waitFor();
      await revealAll(page);
      await settle(page, 1800);
      await page.screenshot({ path: png(`panel-light-${tag}`), fullPage: true });
      await page.goto('/officer?mode=lite&theme=light');
      await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
      await page.getByTestId('pc-photo-img').waitFor();
      await page.getByTestId('pc-choice-blast').click();
      await page.getByTestId('gate-moment').waitFor();
      await settle(page, 2400);
      await page.screenshot({ path: png(`officer-gate-open-light-${tag}`), fullPage: true });
    });

    test('area trust panel: no replay on this server', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { replay: 'missing', area: 'one-away' } });
      await page.goto('/trust?mode=lite');
      await page.getByTestId('replay-missing').waitFor();
      await revealAll(page);
      await settle(page, 600);
      await page.screenshot({ path: png(`panel-missing-${tag}`), fullPage: true });
    });

    test('verifier', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { area: 'open' } });
      await page.goto(`/verify/${AREA_CRED.replace('urn:uuid:', '')}?mode=lite`);
      await page.getByTestId('area-details').waitFor();
      await settle(page, 3800);
      await page.screenshot({ path: png(`verify-area-authentic-${tag}`), fullPage: true });
      await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite`);
      await page.getByTestId('receipt-photo-trust').waitFor();
      await settle(page, 3800);
      await page.screenshot({ path: png(`verify-advice-authentic-${tag}`), fullPage: true });
    });

    for (const lang of ['en', 'bn'] as const) {
      const q = lang === 'bn' ? '&lang=bn' : '';
      const sfx = lang === 'bn' ? `-bn-${tag}` : `-${tag}`;
      test(`verifier, withdrawn (${lang})`, async ({ page }) => {
        await withSession(page);
        await mockApi(page, { photo: { area: 'open', withdrawn: true } });
        await page.goto(`/verify/${AREA_CRED.replace('urn:uuid:', '')}?mode=lite${q}`);
        await page.getByTestId('area-details').waitFor();
        await settle(page, 4200);
        await page.screenshot({ path: png(`verify-area-withdrawn${sfx}`), fullPage: true });
        await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite${q}`);
        await page.getByTestId('photo-withdrawn-note').waitFor();
        await settle(page, 4200);
        await page.screenshot({ path: png(`verify-advice-withdrawn${sfx}`), fullPage: true });
      });
    }

    test('landing: the proof section links to the panel', async ({ page }) => {
      await mockApi(page);
      await page.goto('/?mode=lite');
      await page.getByTestId('prove-trust-link').scrollIntoViewIfNeeded();
      await settle(page, 1500);
      await page.screenshot({ path: png(`landing-proof-${tag}`) });
    });
  });
}
