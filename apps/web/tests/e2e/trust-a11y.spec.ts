import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mockApi';
import { AREA_CRED, PHOTO_RECEIPT_ID } from './trustMock';
import { photoUrl, sendPhoto, withSession } from './trustHelpers';

/**
 * Accessibility of the earned-trust screens (axe, WCAG 2.2 A and AA rules) against the mocked API: the area trust panel
 * with its chart, the farmer's photo card in each state, the officer's photo case before and after the answer and at a gate
 * event, and the verifier's area-trust and withdrawn views. Colour contrast runs in both themes.
 * Scope: each audit covers the new components only. The rest of the farmer page and the officer header are older screens
 * with a few known findings of their own (the light theme's "go" chip on its tinted fill reaches 4.3:1, the sun chip 4.49:1,
 * the weather-day buttons' names, two small voice buttons); they are listed in docs/design/DESIGN.md, not hidden here.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('kl.mode', 'lite');
    } catch {
      /* ignore */
    }
  });
});

async function audit(page: Page, label: string, scope = 'main', skip: string[] = []) {
  let builder = new AxeBuilder({ page }).include(scope).withTags(TAGS);
  for (const sel of skip) builder = builder.exclude(sel);
  const r = await builder.analyze();
  const bad = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')} :: ${(v.nodes[0]?.failureSummary ?? '').split('\n').slice(0, 3).join(' | ')}`);
  expect(bad, `${label}: no axe violations`).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    test.use({ colorScheme: theme });
    const q = theme === 'light' ? '&theme=light' : '';

    test('area trust panel with a replay and the live meter', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { replay: 'ready', area: 'one-away' } });
      await page.goto(`/trust?mode=lite${q}`);
      await page.getByTestId('replay-chart').waitFor();
      await page.waitForTimeout(1800);
      await audit(page, 'trust panel');
      await page.getByTestId('replay-area-BD-A').click();
      await page.waitForTimeout(1200);
      await audit(page, 'trust panel, an area that never opened');
    });

    test('area trust panel: no replay, and the sample curves', async ({ page }) => {
      await mockApi(page);
      await page.goto(`/trust?mode=lite${q}`);
      await page.getByTestId('replay-missing').waitFor();
      await audit(page, 'trust panel, 404');
      await page.goto(`/trust?sample=1&mode=lite${q}`);
      await page.getByTestId('replay-chart').waitFor();
      await page.getByTestId('replay-area-BD-E').click();
      await page.waitForTimeout(1200);
      await audit(page, 'trust panel, sample with a closing');
    });

    test('farmer photo card: idle, with a photo, answered by the officer, answered automatically', async ({ page }) => {
      await mockApi(page, { photo: { route: 'officer', area: 'fresh' } });
      await page.goto(photoUrl(q));
      await page.getByTestId('area-take').waitFor();
      await audit(page, 'farmer card, idle', '[data-testid=photo-card]');
      await sendPhoto(page, true);
      await page.getByTestId('area-officer-title').waitFor();
      await page.waitForTimeout(900);
      await audit(page, 'farmer card, officer route', '[data-testid=photo-card]');
    });

    test('farmer photo card, automatic answer with the plan', async ({ page }) => {
      await mockApi(page, { photo: { route: 'auto' } });
      await page.goto(photoUrl(q));
      await page.getByTestId('area-take').waitFor();
      await sendPhoto(page, false);
      await page.getByTestId('area-plan').waitFor();
      await page.waitForTimeout(900);
      // the plan below the answer is the shared action list and receipt (checked with the farmer page), so it is left out here
      await audit(page, 'farmer card, automatic route', '[data-testid=photo-card]', ['[data-testid=area-plan]']);
    });

    test('officer photo case: open, answered, and the gate moment', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { area: 'one-away', route: 'officer', cases: [{}] } });
      await page.goto(`/officer?mode=lite${q}`);
      await page.locator('[data-testid=case-row][data-kind=photo]').first().click();
      await page.getByTestId('pc-photo-img').waitFor();
      await page.getByTestId('pc-else').click();
      await audit(page, 'officer photo case, open', '[data-testid=photo-case-detail]');
      await page.getByTestId('pc-choice-blast').click();
      await page.getByTestId('gate-moment').waitFor();
      await page.waitForTimeout(2200);
      await audit(page, 'officer photo case, trust earned', '[data-testid=photo-case-detail]');
    });

    test('verifier: area trust credential and withdrawn advice', async ({ page }) => {
      await withSession(page);
      await mockApi(page, { photo: { area: 'open', withdrawn: true } });
      await page.goto(`/verify/${AREA_CRED.replace('urn:uuid:', '')}?mode=lite${q}`);
      await page.getByTestId('area-details').waitFor();
      await page.waitForTimeout(3800);
      await audit(page, 'verifier, area credential withdrawn');
      await page.goto(`/verify/${PHOTO_RECEIPT_ID}?mode=lite${q}`);
      await page.getByTestId('photo-withdrawn-note').waitFor();
      await page.waitForTimeout(3800);
      await audit(page, 'verifier, advice withdrawn');
    });
  });
}
