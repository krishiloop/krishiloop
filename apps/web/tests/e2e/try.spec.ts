import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * "Try it yourself" (/try, builder I): six tools on KrishiLoop's real logic, no backend needed.
 *  - Should I spray?: the planner port answers as the sliders move (keyboard), cites the rule, quote and page, abstains
 *    to the officer when no sourced rule fits, and shows an UNSIGNED receipt preview;
 *  - Take advice back: a simulated recall turns the receipts that cite the rule Recalled, and the spray tool then hands
 *    the decision to the officer (a recalled rule is never served);
 *  - Weather warnings: PRACTICE weather, the shield's four checks and the rule each warning cites, the bars by keyboard;
 *  - Check a receipt: an SMS code opens the verifier (recorded receipt: Authentic);
 *  - Check a leaf photo: the model loads only on start, reads a drawn test leaf, the gate answers, research weights label;
 *  - How much can I save?: the calculator, reused;
 *  - axe (WCAG 2.2 A + AA, no serious or critical) in both themes; 360 px: no sideways scroll (English and Bangla).
 * Run on its own port: E2E_PORT=5253 npx playwright test try.
 */
test.describe.configure({ retries: 1 }); // the dev server is shared with other builders: one retry for an HMR reload

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGE = '/try?lang=en';

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((a) => (a.effect?.getTiming().iterations ?? 1) !== Infinity).map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}

/** Reveal every card first: axe measures contrast on what is painted. */
async function revealAll(page: Page) {
  for (const id of ['spray', 'leaf', 'receipt', 'weather', 'savings', 'recall']) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await settle(page);
}

async function axe(page: Page, label: string) {
  await revealAll(page);
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

const spray = (page: Page) => page.getByTestId('spray-result');

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.evaluate(() => sessionStorage.removeItem('kl.sampleRecalls'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Six tools you can use right now');
});

/* ------------------------------------------------------------------ Should I spray? */
test('should I spray: the sourced rule answers as the sliders move, by keyboard', async ({ page }) => {
  const r = spray(page);
  await expect(r).toHaveAttribute('data-word', 'dont_spray');
  await expect(r).toHaveAttribute('data-rule', 'R-BDR-002');
  await expect(page.getByTestId('spray-word')).toHaveText("Don't spray");
  await expect(page.getByTestId('spray-rule')).toContainText('Rule R-BDR-002 v1');
  await expect(page.getByTestId('spray-rule')).toContainText('page 1');
  await expect(page.getByTestId('spray-rule').locator('blockquote')).toContainText('জমির অধিকাংশ গাছে');

  // two egg-laying females per hill reach BRRI's threshold (the team uses the lower end of 2-4)
  await page.getByTestId('spray-females').focus();
  await page.keyboard.press('ArrowRight');
  await expect(r).toHaveAttribute('data-rule', 'R-BDR-001');
  await expect(page.getByTestId('spray-word')).toHaveText('Check again');
  await expect(page.getByTestId('spray-rule')).toContainText('contact your officer');

  // Kenya potato: humid, mild days ahead and an unprotected crop
  await page.getByTestId('spray-case').getByRole('radio', { name: 'Potato, growing', exact: true }).check();
  await expect(r).toHaveAttribute('data-rule', 'R-PLB-011');
  await page.getByTestId('spray-humidity').focus();
  await page.keyboard.press('ArrowRight'); // 90%
  await page.getByTestId('spray-high').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft'); // 24 C, inside 10-25
  await expect(r).toHaveAttribute('data-rule', 'R-PLB-008');
  await expect(page.getByTestId('spray-word')).toHaveText('Check again');

  // protected, then heavy rain: no input-decision rule covers it, so the officer decides
  await page.getByTestId('spray-protected').getByRole('radio', { name: 'Yes', exact: true }).check();
  await expect(r).toHaveAttribute('data-rule', 'R-PLB-011');
  await page.getByTestId('spray-rain').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // 20 mm in a day
  await expect(r).toHaveAttribute('data-word', 'officer');
  await expect(r).toHaveAttribute('data-reason', 'no_matching_rule');
  await expect(page.getByTestId('spray-abstain')).toHaveText('No sourced rule: the officer decides.');
  await expect(page.getByTestId('spray-word')).toHaveText('Ask the officer');
  await expect(r).toContainText('No rule in our packs says "spray"');
});

test('should I spray: the receipt preview says it is not signed and shows the team-set numbers', async ({ page }) => {
  await page.getByTestId('spray-case').getByRole('radio', { name: 'Rice, booting', exact: true }).check();
  await page.getByTestId('spray-low').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); // 24 C, inside 22-32
  await expect(spray(page)).toHaveAttribute('data-rule', 'R-BDR-004'); // humid, mild days favour leaf blight
  await page.getByTestId('spray-preview').locator('summary').click();
  const pv = page.getByTestId('spray-preview');
  await expect(page.getByTestId('spray-unsigned')).toHaveText('Preview, not signed');
  await expect(pv).toContainText('R-BDR-004 v1');
  await expect(pv).toContainText('humid_rh_pct_min = 70');
  await expect(pv).toContainText('not from the source');
  await expect(pv).toContainText('Humid, mild days: 7 days');
  await expect(pv).toContainText('Not signed.');
});

/* ------------------------------------------------------------------ recall, and the loop back into the spray tool */
test('take advice back: the receipts that used the rule turn Recalled, and the planner stops serving it', async ({ page }) => {
  const recall = page.getByTestId('try-recall');
  await recall.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('recall-ticket-0')).toHaveAttribute('data-status', 'authentic');
  await expect(recall).toContainText('Used by 4 of 20 sample receipts');
  await page.getByTestId('recall-R-BDR-002').click();
  await expect(page.getByTestId('recall-ticket-0')).toHaveAttribute('data-status', 'recalled');
  await expect(page.getByTestId('recall-ticket-0').locator('.stamp')).toHaveText('Recalled');
  await expect(page.getByTestId('recall-ticket-1')).toHaveAttribute('data-status', 'authentic');
  await expect(page.getByTestId('recall-reach')).toContainText('4 of 20 receipts now show Recalled');

  // the same rule is no longer served in "Should I spray?": the officer decides
  await expect(spray(page)).toHaveAttribute('data-reason', 'rule_recalled');
  await expect(page.getByTestId('spray-abstain')).toContainText('R-BDR-002 v1');

  await page.getByTestId('recall-undo').click();
  await expect(page.getByTestId('recall-ticket-0')).toHaveAttribute('data-status', 'authentic');
  await expect(spray(page)).toHaveAttribute('data-rule', 'R-BDR-002');
});

/* ------------------------------------------------------------------ weather warnings */
test('weather warnings: practice week, four checks, the rule each warning cites, bars by keyboard', async ({ page }) => {
  const w = page.getByTestId('try-weather');
  await w.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('weather-practice')).toHaveText('Practice weather, not a forecast');
  await expect(page.getByTestId('weather-count')).toHaveText('3 warnings this week');
  await expect(page.getByTestId('weather-heavy_rain')).toHaveAttribute('data-level', 'warn');
  await expect(page.getByTestId('weather-cite-heavy_rain')).toContainText('Rule R-BDR-009 v1');
  await page.getByTestId('weather-heavy_rain').getByRole('button').click();
  await expect(page.getByTestId('weather-heavy_rain').locator('blockquote')).toContainText('ঝড়োবৃষ্টির পর ইউরিয়া সার দেয়া যাবে না');
  await expect(page.getByTestId('weather-heavy_rain')).toContainText('Set by our team, not from the source');

  await page.getByTestId('weather-preset-calm').click();
  await expect(page.getByTestId('weather-heavy_rain')).toHaveAttribute('data-level', 'clear');
  await expect(page.getByTestId('weather-count')).toHaveText('No warnings this week');
  // drag day 2's rain up with the keyboard: End = the top of the bar
  await page.getByTestId('weather-rain-1').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('weather-rain-1')).toHaveAttribute('aria-valuenow', '80');
  await expect(page.getByTestId('weather-heavy_rain')).toHaveAttribute('data-level', 'warn');
  // the heat line is 35 C (team-set): day 4 to 36 C
  await page.getByTestId('weather-heat-3').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('weather-heat')).toHaveAttribute('data-level', 'warn');
  // no river data: unknown, never "no risk"
  await page.getByTestId('weather-river').getByRole('radio', { name: 'No river data', exact: true }).check();
  await expect(page.getByTestId('weather-flood')).toHaveAttribute('data-level', 'unknown');
  await expect(page.getByTestId('weather-flood')).toContainText('Unknown is never "no risk"');
  // Kenya potato cites CIP
  await page.getByTestId('weather-case').getByRole('radio', { name: 'Potato, growing', exact: true }).check();
  await page.getByTestId('weather-preset-storm').click();
  await expect(page.getByTestId('weather-cite-heavy_rain')).toContainText('R-PLB-011');
});

/* ------------------------------------------------------------------ check a receipt */
test('check a receipt: an SMS code is recognised and opens the verifier', async ({ page }) => {
  await page.getByTestId('try-receipt').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('receipt-open')).toBeDisabled();
  await page.getByTestId('receipt-input').fill('hello');
  await expect(page.getByTestId('receipt-state')).toHaveText('Not a code or receipt link yet');
  await page.getByTestId('receipt-input').fill('3mzx w8y9'); // any case, spaces ignored, as on the server
  await expect(page.getByTestId('receipt-state')).toHaveText('SMS code 3MZX-W8Y9');
  await page.getByTestId('receipt-input').fill('');
  await page.getByTestId('receipt-sample').click();
  await expect(page.getByTestId('receipt-input')).toHaveValue('3MZX-W8Y9');
  await page.getByTestId('receipt-input').press('Enter');
  await expect(page).toHaveURL(/\/v\/3MZX-W8Y9$/);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-status', 'authentic', { timeout: 20_000 });
});

/* ------------------------------------------------------------------ check a leaf photo */
test('check a leaf photo: the model loads only on start, reads a drawn test leaf, the gate answers', async ({ page }) => {
  test.setTimeout(120_000);
  const leaf = page.getByTestId('try-leaf');
  await leaf.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('leaf-weights')).toHaveText('Research weights (trained on PlantWild, non-commercial)');
  const asked = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/models/agritriage/')));
  expect(asked, 'no model bytes before the visitor starts').toBe(false);
  await page.getByTestId('leaf-test').click();
  const res = page.getByTestId('leaf-result');
  await expect(res).toBeVisible({ timeout: 90_000 });
  expect(['diagnose', 'shortlist', 'refer']).toContain(await res.getAttribute('data-outcome'));
  await expect(res).toContainText('Drawn by this page, not a real leaf');
  await expect(page.getByTestId('leaf-top').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('leaf-map-state')).toHaveText('Warm squares: hiding them lowered the answer the most.', { timeout: 60_000 });
  // the crop is known: the same reading, gated again at once
  await page.getByTestId('leaf-crop').getByRole('radio', { name: 'Rice', exact: true }).check();
  await expect(page.getByTestId('leaf-top')).toContainText('Rice');
  await axe(page, 'leaf result');
});

/* ------------------------------------------------------------------ savings */
test('how much can I save: the calculator, reused, answers as you type', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('kl.calc.v1'));
  await page.reload();
  const sv = page.getByTestId('try-savings');
  await sv.scrollIntoViewIfNeeded();
  await sv.getByTestId('kg-calc-size').fill('2');
  await sv.getByTestId('kg-calc-product').fill('600');
  await sv.getByTestId('kg-calc-labour').fill('300');
  await sv.getByTestId('kg-calc-sprays').fill('3');
  await expect(sv.getByTestId('kg-calc-total')).toHaveText('Tk 5,400');
});

/* ------------------------------------------------------------------ keyboard, accessibility, phones */
test('keyboard: a jump link moves to its tool', async ({ page }) => {
  const link = page.getByRole('navigation', { name: 'Jump to a tool' }).getByRole('link', { name: /Weather warnings/ });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#weather$/);
  await expect(page.getByTestId('try-weather')).toBeInViewport();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe, ${theme} theme: every tool, with the preview and a weather rule open`, async ({ page }) => {
    await page.goto(`${PAGE}&theme=${theme}`);
    await page.getByTestId('spray-preview').locator('summary').click();
    await page.getByTestId('weather-heavy_rain').getByRole('button').click();
    await page.getByTestId('recall-R-BDR-009').click();
    await axe(page, `/try ${theme}`);
  });
}

for (const lang of ['en', 'bn'] as const) {
  test(`360 px wide, ${lang}: no sideways scroll, and the tools still work`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/try?lang=${lang}`);
    await revealAll(page);
    await noOverflow(page);
    await page.getByTestId('spray-preview').locator('summary').click();
    await page.getByTestId('weather-heavy_rain').getByRole('button').click();
    await noOverflow(page);
    // thumb-sized: every button and choice is at least 44 px tall
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.try-page :is(button, .try-pill, input[type=range], [role=slider], a.try-jump-link)')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height < 40).length,
    );
    expect(small, 'targets under 40 px').toBe(0);
  });
}
