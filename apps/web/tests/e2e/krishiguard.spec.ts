import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * KrishiGuard pillars (builder R), in RECORDED mode (`?sample=1`, deterministic, no backend):
 *  - the Climate-Smart Shield on Today: four checks, unknown said as unknown, team-set thresholds labelled, and the
 *    SIMULATED stormy week citing BRRI's rule R-BDR-009;
 *  - the savings calculator in its drawer: live Taka, unit conversion, the bigha size, Escape;
 *  - "ask an officer to visit or call": validation, the confirmation, and the case in the officer inbox;
 *  - the officer's outbreak radar: the map, the SIMULATION label, k-anonymous cells and hidden counts, warn neighbours;
 *  - axe (WCAG 2.2 A + AA): no serious or critical issues, both themes; 360 px wide: no sideways scroll.
 * Run on its own port: E2E_PORT=5202 npx playwright test krishiguard.
 */
test.describe.configure({ retries: 1 }); // the dev server is shared with other builders: one retry for an HMR reload

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const APP = '/app?sample=1&lang=en&field=BD-SAMPLE-02&profile=demo-farmer-d&tab=today';

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((a) => (a.effect?.getTiming().iterations ?? 1) !== Infinity).map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}

async function axe(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')} :: ${(v.nodes[0]?.failureSummary ?? '').split('\n').slice(0, 3).join(' | ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
}

const shield = (page: Page) => page.getByTestId('kg-shield');
/** The shield's chunk loads after the plan; the first dev-server compile can be slow on a busy machine. */
const firstShield = (page: Page) => expect(shield(page)).toBeVisible({ timeout: 30_000 });

/* ------------------------------------------------------------------ Climate-Smart Shield */
test('the shield: four checks from the recorded forecast, unknown as unknown, team thresholds labelled', async ({ page }) => {
  await page.goto(APP);
  await firstShield(page);
  await expect(page.getByTestId('kg-shield-title')).toHaveText('No warnings this week');
  for (const k of ['heavy_rain', 'heat', 'flood', 'disease']) await expect(page.getByTestId(`kg-check-${k}`)).toBeVisible();
  await expect(page.getByTestId('kg-check-heavy_rain')).toHaveAttribute('data-level', 'clear');
  // no river forecast for this field: unknown, never "no risk"
  const flood = page.getByTestId('kg-check-flood');
  await expect(flood).toHaveAttribute('data-level', 'unknown');
  await expect(flood).toContainText('No river forecast');
  await flood.getByRole('button').click();
  await expect(flood).toContainText('Unknown is never "no risk"');
  // a clear check opens to its team-set threshold, said as such
  await page.getByTestId('kg-check-disease').getByRole('button').click();
  await expect(page.getByTestId('kg-team-disease')).toContainText('Threshold set by our team (not from a source; review pending)');
  await expect(shield(page)).toContainText('Recorded 2 Nov');
  await expect(page.getByTestId('kg-hear')).toBeVisible();
});

test('the simulated stormy week: labelled SIMULATED, and the rain warning cites BRRI rule R-BDR-009', async ({ page }) => {
  await page.goto(APP);
  await firstShield(page);
  await page.getByTestId('kg-sim-toggle').click();
  await expect(page.getByTestId('kg-shield-sim')).toContainText('Simulated stormy week');
  await expect(page.getByTestId('kg-shield-title')).toHaveText('3 warnings this week');
  const rain = page.getByTestId('kg-check-heavy_rain');
  await expect(rain).toHaveAttribute('data-level', 'warn');
  const rule = page.getByTestId('kg-rule-heavy_rain');
  await expect(rule).toContainText('Rule R-BDR-009 v1');
  await expect(rule).toContainText('Do not apply urea after a thunderstorm');
  await expect(rule.locator('blockquote')).toContainText('ঝড়োবৃষ্টির পর ইউরিয়া সার দেয়া যাবে না');
  await expect(page.getByTestId('kg-team-heavy_rain')).toContainText('20 mm/day');
  await expect(page.getByTestId('kg-check-heat')).toContainText('Why it matters');
  await expect(shield(page)).not.toContainText('Open-Meteo'); // a made-up week names no forecast
  await page.getByTestId('kg-sim-toggle').click();
  await expect(page.getByTestId('kg-shield-title')).toHaveText('No warnings this week');
});

test('Bangla: the shield and its warnings in Bangla', async ({ page }) => {
  await page.goto(APP.replace('lang=en', 'lang=bn'));
  await expect(page.getByTestId('kg-shield-title')).toHaveText('এই সপ্তাহে কোনো সতর্কতা নেই');
  await page.getByTestId('kg-sim-toggle').click();
  await expect(page.getByTestId('kg-rule-heavy_rain')).toContainText('ঝড়বৃষ্টির পর ইউরিয়া সার দেবেন না');
});

test('near you: the simulated scenario for the field’s district, labelled, and the k rule said', async ({ page }) => {
  await page.goto(APP);
  const near = page.getByTestId('kg-near');
  await expect(near).toContainText('Mymensingh district');
  await expect(near).toContainText('Real reports need the live service');
  await expect(page.getByTestId('kg-near-sim')).toContainText('Simulated');
  await expect(page.getByTestId('kg-near-sim')).toContainText('9 farmers reported bacterial leaf blight');
  await expect(near).toContainText('at least 3 farmers reported. Never one farmer.');
});

/* ------------------------------------------------------------------ savings calculator */
test('the calculator: Taka saved live, units convert, the bigha size is editable, Escape closes', async ({ page }) => {
  await page.goto(APP);
  await page.evaluate(() => localStorage.removeItem('kl.calc.v1'));
  await page.getByTestId('kg-open-calc').click();
  const drawer = page.getByRole('dialog', { name: 'What skipping an unneeded spray saves' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Your numbers, not ours');
  await drawer.getByTestId('kg-calc-size').fill('2');
  await drawer.getByTestId('kg-calc-product').fill('600');
  await drawer.getByTestId('kg-calc-labour').fill('300');
  await drawer.getByTestId('kg-calc-sprays').fill('3');
  await expect(drawer.getByTestId('kg-calc-total')).toHaveText('Tk 5,400'); // 2 bigha × Tk 900 × 3
  await expect(drawer.getByTestId('kg-calc-same')).toContainText('66 decimal');
  // switching to acre keeps the same field and the same money
  await drawer.getByRole('radio', { name: 'acre', exact: true }).check();
  await expect(drawer.getByTestId('kg-calc-size')).toHaveValue('0.66');
  await expect(drawer.getByTestId('kg-calc-total')).toHaveText('Tk 5,400');
  await drawer.getByRole('radio', { name: 'bigha', exact: true }).check();
  await expect(drawer.getByTestId('kg-calc-size')).toHaveValue('2');
  // a smaller local bigha: same typed numbers, smaller field
  await drawer.getByTestId('kg-calc-dpb').fill('20');
  await expect(drawer.getByTestId('kg-calc-same')).toContainText('40 decimal');
  await expect(drawer.getByTestId('kg-calc-total')).toHaveText('Tk 5,400');
  // Bangla digits are numbers too; nonsense says so
  await drawer.getByTestId('kg-calc-sprays').fill('৪');
  await expect(drawer.getByTestId('kg-calc-total')).toHaveText('Tk 7,200');
  await drawer.getByTestId('kg-calc-sprays').fill('-1');
  await expect(drawer.getByTestId('kg-calc-out')).toContainText('Type a number of 0 or more');
  await axe(page, 'calculator drawer');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId('kg-open-calc')).toBeFocused(); // focus comes back
});

/* ------------------------------------------------------------------ ask an officer to visit or call */
test('booking: validation, the confirmation with a masked phone, and the case in the officer inbox', async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId('kg-open-visit').click();
  const drawer = page.getByRole('dialog', { name: 'Ask an officer to visit or call' });
  await expect(drawer).toBeVisible();
  await drawer.getByTestId('kg-visit-send').click();
  await expect(drawer.getByRole('alert')).toContainText('Pick a day.');
  await drawer.getByRole('radio', { name: 'Call me' }).check();
  await drawer.getByTestId('kg-day-2').check();
  await drawer.getByRole('radio', { name: 'Evening' }).check();
  await drawer.getByTestId('kg-visit-send').click();
  await expect(drawer.getByRole('alert')).toContainText('A call needs a phone number.');
  await drawer.getByTestId('kg-visit-phone').fill('+880 1712-345678');
  await drawer.getByTestId('kg-visit-note').fill('Brown patches spreading near the canal');
  await axe(page, 'booking form');
  await drawer.getByTestId('kg-visit-send').click();
  const done = drawer.getByTestId('kg-visit-done');
  await expect(done).toContainText('Request kept on this phone'); // recorded mode: not sent, and it says so
  await expect(done).toContainText('+880••••••••78');
  await expect(done).not.toContainText('1712345678');
  await expect(done).toContainText('This demo calls and visits no one.');
  const caseId = (await drawer.getByTestId('kg-visit-case').textContent())!.trim();
  await axe(page, 'booking confirmation');
  await done.getByRole('button', { name: 'Done' }).click();
  await expect(drawer).toBeHidden();
  // the officer console in this browser shows the request
  await page.goto(`/officer/${caseId}?sample=1&lang=en`);
  const detail = page.getByTestId('case-detail');
  await expect(detail).toContainText('Visit or call request');
  await expect(page.getByTestId('case-question')).toHaveText('Brown patches spreading near the canal');
  await expect(page.getByTestId('case-details')).toContainText('+880••••••••78');
});

/* ------------------------------------------------------------------ the officer's radar */
test('radar: the map, the SIMULATION label, k-anonymous cells, hidden counts and warn neighbours', async ({ page }) => {
  await page.goto('/officer?tab=radar&sample=1&lang=en');
  await expect(page.getByRole('tab', { name: /Disease reports map/ })).toHaveAttribute('aria-selected', 'true');
  const radar = page.getByTestId('kg-radar');
  await expect(radar).toBeVisible();
  // recorded mode starts on the simulated scenario, labelled on the map and above it
  await expect(page.getByTestId('kg-radar-simnote')).toContainText('Simulated village scenario');
  await expect(page.getByTestId('kg-radar-stamp')).toHaveText('SIMULATION');
  const map = page.getByTestId('kg-radar-map');
  await expect(map.locator('.kg-map-base path')).toHaveCount(64); // Bangladesh's districts
  await expect(map.getByRole('img')).toHaveAttribute('aria-label', /Map of Bangladesh: 5 places with reports/);
  await expect(map).toContainText('CC BY 3.0 IGO');
  const cells = page.getByTestId('kg-radar-cell');
  await expect(cells.first()).toContainText('Mymensingh: bacterial leaf blight');
  await expect(cells.first()).toContainText('9 farmers');
  for (const n of await cells.allTextContents()) expect(n).not.toMatch(/\b[12] farmers\b/); // never fewer than 3
  await expect(page.getByTestId('kg-radar-hidden')).toContainText('5 reports in 2 places are hidden: fewer than 3 farmers each.');
  await axe(page, 'radar, simulated');
  // warn neighbours: the fixed notice, and in recorded mode nothing is sent
  await cells.first().getByTestId('kg-warn').click();
  const box = page.getByTestId('kg-warn-box');
  await expect(box).toContainText('SIMULATED (demo, not real reports).');
  await expect(box).toContainText('ask your officer before you spray');
  await box.getByTestId('kg-warn-send').click();
  await expect(page.getByTestId('kg-warn-result')).toContainText('Recorded mode: no live service, so nothing was sent.');
  // Kenya's counties
  await page.getByRole('radio', { name: 'Kenya' }).click();
  await expect(map.locator('.kg-map-base path')).toHaveCount(47);
  await expect(cells.first()).toContainText('Nyandarua: late blight');
  await expect(map).toContainText('Public Domain');
  // the real layer needs the live service, and says so
  await page.getByRole('radio', { name: 'Real reports' }).click();
  await expect(page.getByTestId('kg-radar-realoff')).toContainText('needs the live service');
  await expect(page.getByTestId('kg-radar-stamp')).toHaveCount(0);
  await expect(cells).toHaveCount(0);
});

/* ------------------------------------------------------------------ accessibility and small screens */
for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: Today with the shield (and the simulated week) and the radar`, async ({ page }) => {
    await page.goto(`${APP}&theme=${theme}`);
    await firstShield(page);
    await expect(page.getByTestId('kg-near')).toContainText('Mymensingh');
    await axe(page, `Today ${theme}`);
    await page.getByTestId('kg-sim-toggle').click();
    await expect(page.getByTestId('kg-rule-heavy_rain')).toBeVisible();
    await axe(page, `Today simulated ${theme}`);
    await page.goto(`/officer?tab=radar&sample=1&lang=en&theme=${theme}`);
    await expect(page.getByTestId('kg-radar-map')).toBeVisible();
    await axe(page, `radar ${theme}`);
  });
}

test('360 px: no sideways scroll on Today, in both drawers, and on the radar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto(APP);
  await firstShield(page);
  await page.getByTestId('kg-sim-toggle').click();
  await expect(page.getByTestId('kg-rule-heavy_rain')).toBeVisible();
  await noOverflow(page);
  await page.getByTestId('kg-open-calc').click();
  await expect(page.getByTestId('kg-calc')).toBeVisible();
  await noOverflow(page);
  const calcBox = await page.getByTestId('kg-calc').boundingBox();
  expect(calcBox!.x + calcBox!.width).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');
  await page.getByTestId('kg-open-visit').click();
  await expect(page.getByTestId('kg-visit-form')).toBeVisible();
  await noOverflow(page);
  const days = await page.getByTestId('kg-day-14').boundingBox();
  expect(days!.x + days!.width).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');
  await page.goto('/officer?tab=radar&sample=1&lang=en');
  await expect(page.getByTestId('kg-radar-map')).toBeVisible();
  await noOverflow(page);
  await page.getByTestId('kg-radar-cell').first().getByTestId('kg-warn').click();
  await expect(page.getByTestId('kg-warn-box')).toBeVisible();
  await noOverflow(page);
});
