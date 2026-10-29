import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * /trust, earned trust for photo diagnosis (rebuilt Oct 29). `?sample=1` makes it deterministic: the page then shows the
 * bundled copy of the real replay (ml/vision/artifacts/area_trust_replay.json), labelled as such, and the sandbox says
 * sample mode is on. One live smoke runs against whatever the dev server's API answers.
 * The farmer photo flow and the officer verdict flow are covered by the farmer and officer specs.
 */
const errors = (page: Page) => {
  const list: string[] = [];
  page.on('pageerror', (e) => list.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && list.push(m.text()));
  return list;
};

async function noSeriousAxe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

/** Jump the replay to its end with the keyboard (the range input), so the numbers are the file's final ones. */
async function toEnd(page: Page) {
  const range = page.getByTestId('replay-scrub');
  await range.focus();
  await page.keyboard.press('End');
}

test.describe('/trust in recorded mode', () => {
  test('the idea, the bar and the tiers', async ({ page }) => {
    const errs = errors(page);
    await page.goto('/trust?sample=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Photo answers earn trust one area at a time.' })).toBeVisible();
    await expect(page.getByTestId('hero-meter')).toContainText('Gate open after 93 officer answers');

    const tiles = page.getByTestId('policy-tiles');
    for (const v of ['0.85', '30/50', '≥ 0.85', '< 0.80', '10%']) await expect(tiles).toContainText(v);
    await expect(tiles).toContainText('Sure answers needed, among the last 50 judged');
    await expect(page.getByTestId('tiers')).toContainText('Off: photos never drive inputs');
    const strict = page.getByTestId('strictness');
    await expect(strict).toContainText('30 of 30 right');
    await expect(strict).toContainText('48 of 50 right');
    expect(errs).toEqual([]);
  });

  test('the real replay: labelled, scrubbable to the end, with the gate marker and the final numbers', async ({ page }) => {
    await page.goto('/trust?sample=1');
    await expect(page.getByTestId('replay-label')).toHaveText('Replay of public datasets: their labels stand in for officers. Not real officers or farms.');
    await expect(page.getByTestId('replay-bundled')).toBeVisible();
    const chart = page.getByTestId('replay-chart');
    await expect(chart).toHaveAttribute('data-area', 'BD-D');
    await expect(chart).toHaveAttribute('data-open-at', '93');
    // seed 0 is one order: the panel beside it gives the median and 95% range over 200 orders (earned_trust_ci.json)
    await expect(page.getByTestId('hero-ci')).toContainText('median 102, 95% range 70–126');
    const ci = page.getByTestId('ci-panel');
    await expect(ci.getByTestId('ci-BD-D-open')).toContainText('102 70–126');
    await expect(ci.getByTestId('ci-BD-D-auto')).toContainText('86.5% 84.9%–88.2%');
    await expect(ci.getByTestId('ci-BD-D-right')).toContainText('99.4% 99.0%–99.7%');
    await expect(ci.getByTestId('ci-BD-A-open')).toContainText('185–never');
    await expect(ci.locator('[data-area]')).toHaveCount(4);

    await toEnd(page);
    await expect(page.getByTestId('ro-answers')).toHaveText('351');
    await expect(page.getByTestId('ro-bound')).toHaveText('0.93');
    await expect(page.getByTestId('ro-auto')).toHaveText('86% · 1,403');
    await expect(page.getByTestId('ro-right')).toHaveText('99.6%');
    await expect(page.getByTestId('replay-gate')).toHaveText('Gate open');
    await expect(page.getByTestId('gate-marker')).toHaveAttribute('data-on', 'true');

    // back to the start: the bound does not count yet and the gate is closed
    await page.keyboard.press('Home');
    await expect(page.getByTestId('ro-bound')).toHaveText('not counted yet');
    await expect(page.getByTestId('replay-gate')).toHaveText('Gate closed');
    await expect(page.getByTestId('gate-marker')).toHaveAttribute('data-on', 'false');
  });

  test('play and pause', async ({ page }) => {
    await page.goto('/trust?sample=1');
    await toEnd(page);
    await page.getByRole('button', { name: 'Play the replay again' }).click();
    const pause = page.getByRole('button', { name: 'Pause the replay' });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.getByRole('button', { name: 'Play the replay' })).toBeVisible();
    const answers = Number((await page.getByTestId('ro-answers').textContent())?.replace(/,/g, ''));
    expect(answers).toBeGreaterThan(0);
    expect(answers).toBeLessThan(351);
  });

  test('the area cards pick the replayed area', async ({ page }) => {
    await page.goto('/trust?sample=1');
    const cards = page.getByTestId('area-cards');
    await expect(cards.getByRole('button')).toHaveCount(4);
    await expect(page.getByTestId('area-card-BD-D')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('area-card-BD-A')).toContainText('229');
    await expect(page.getByTestId('area-card-BD-E')).toContainText('328');
    await page.getByTestId('area-card-BD-A').click();
    await expect(page.getByTestId('area-card-BD-A')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('replay-chart')).toHaveAttribute('data-area', 'BD-A');
    await expect(page.getByTestId('replay-chart')).toHaveAttribute('data-open-at', '229');
  });

  test('the sandbox says why it is empty, and method and limits open on request', async ({ page }) => {
    await page.goto('/trust?sample=1');
    await expect(page.getByTestId('sb-sample')).toHaveText('Sample mode is on, so there is no live meter.');
    await expect(page.getByTestId('sb-farmer')).toHaveAttribute('href', /\/app\?field=BD-SAMPLE-02&profile=demo-farmer-d#photo/);
    const method = page.getByTestId('method');
    await expect(method.getByText('No real officer has used it yet.')).toBeHidden();
    await method.getByText('Method and limits').click();
    await expect(method.getByText('No real officer has used it yet.')).toBeVisible();
    await expect(method).toContainText('Wilson 95% lower bound over the last 50 sure answers; at least 30 needed.');
  });

  test('with reduced motion the whole replay is shown at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/trust?sample=1');
    await expect(page.getByTestId('ro-answers')).toHaveText('351');
    await expect(page.getByTestId('replay-gate')).toHaveText('Gate open');
  });

  test('a phone gets the same chart and controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trust?sample=1');
    await toEnd(page);
    await expect(page.getByTestId('ro-right')).toHaveText('99.6%');
    const box = await page.getByTestId('replay-chart').boundingBox();
    expect(box && box.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe, ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/trust?sample=1&theme=${theme}`);
      await expect(page.getByTestId('replay-chart')).toBeVisible();
      await page.getByTestId('method').getByText('Method and limits').click();
      await noSeriousAxe(page, `/trust ${theme}`);
    });
  }
});

test('/trust live smoke: renders whatever the API answers, without errors', async ({ page }) => {
  const errs = errors(page);
  await page.goto('/trust');
  await expect(page.getByTestId('trust-title')).toBeVisible();
  await expect(page.getByTestId('replay-chart').or(page.getByTestId('replay-missing')).or(page.getByTestId('replay-error'))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sandbox')).toBeVisible();
  expect(errs.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
