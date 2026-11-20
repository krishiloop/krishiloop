import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Smoke tests for the shared shell, the home page (/), the receipt page (/receipt) and the About page (/about). The
 * farmer app, the officer console, the verifier, /trust and /proof have their own specs. Home and /receipt show only
 * bundled recorded data and simulations, so they must never call the API.
 */
const noOverflow = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1);
};

const seriousA11y = async (page: Page) => {
  // judge the settled page: wait for the one-off entrance animations (finite, on the document timeline) to end; endless
  // loops and scroll-driven animations never "finish" and are not waited for
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.timeline !== document.timeline || a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
};

test('home: the headline, the merged product, the receipt tiles, and no API calls', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) api.push(u.pathname);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('plant doctor, farm helper and weather warning');
  // the product picture is now the magazine of the seven tools (it replaced the loop ring in the 19 Nov redesign)
  await expect(page.getByRole('heading', { level: 2, name: /One app for the season/ })).toBeVisible();
  // v5 plain words (builder Ho): the seven tools named as a farmer would say them
  for (const name of ['Plant doctor', 'Weather warnings', 'Disease alerts nearby', 'Buy only what you need', 'Bangla voice, any phone', 'A real expert when unsure', 'A receipt anyone can check']) {
    await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
  }
  const slider = page.getByRole('slider', { name: 'A real photo, and what the AI saw in it' });
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(400);
  expect(api, 'the home page never calls the API').toEqual([]);
});

test('receipt: the sentence, a real receipt that prints, and no API calls', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) api.push(u.pathname);
  });
  await page.goto('/receipt');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('receipt anyone can check');
  const receipt = page.getByRole('article', { name: /Advice receipt/ }).first();
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('R-BDR-002 v1');
  await expect(receipt.getByRole('img', { name: 'Verify this receipt' })).toBeVisible();
  await expect(page.getByText('Recorded 2 Nov').first()).toBeVisible();
  await page.waitForTimeout(400);
  expect(api, 'the receipt page never calls the API').toEqual([]);
});

test('receipt: one tap recalls the receipt’s rule, and undoing restores it', async ({ page }) => {
  await page.goto('/receipt');
  const hero = page.locator('section').first();
  await hero.getByRole('radio', { name: 'Recall its rule' }).click();
  await expect(hero.getByText('Recalled', { exact: true })).toBeVisible();
  await expect(hero).toContainText('Every receipt built on it now says Recalled');
  await hero.getByRole('radio', { name: 'Check it' }).click();
  await expect(hero.getByText('Authentic', { exact: true })).toBeVisible();
});

test('receipt: the recall ripple counts exactly the receipts that cite the rule', async ({ page }) => {
  await page.goto('/receipt');
  const section = page.locator('section', { has: page.getByRole('heading', { name: /Recall a rule/ }) });
  await section.scrollIntoViewIfNeeded();
  const rule = section.getByRole('button', { name: /R-BDR-002 v1/ });
  const count = Number(((await rule.textContent()) ?? '').match(/×(\d+)/)?.[1]);
  expect(count).toBeGreaterThan(0);
  await rule.click();
  await expect(rule).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByText(String(count), { exact: true }).first()).toBeVisible();
  await expect(section.getByText(String(96 - count), { exact: true }).first()).toBeVisible();
  await section.getByRole('button', { name: 'Start again' }).click();
  await expect(rule).toHaveAttribute('aria-pressed', 'false');
});

test('home: the linked feature tiles lead somewhere real', async ({ page }) => {
  await page.goto('/');
  const tiles = page.locator('section', { has: page.getByRole('heading', { name: 'Everything here works today.' }) }).getByRole('link');
  await expect(tiles).toHaveCount(2);
  const hrefs = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  expect(hrefs[0]).toBe('/receipt');
  expect(hrefs[1]).toMatch(/^\/verify\//);
});

test('home: Bangla, dark theme, phone width, and no serious accessibility problems', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lang=bn&theme=dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('গাছের ডাক্তার');
  await noOverflow(page);
  expect(await seriousA11y(page)).toEqual([]);
});

test('home: light theme on a laptop has no serious accessibility problems', async ({ page }) => {
  await page.goto('/?theme=light');
  expect(await seriousA11y(page)).toEqual([]);
});

test('header: every page is one click away, and the phone menu works', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  for (const [name, path] of [
    ['Farmer app', '/app'],
    ['Krishi officer', '/krishi-officer'],
    ['Disease map', '/map'],
    ['Try it yourself', '/try'],
    ['Check a receipt', '/verify'],
  ] as const) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
  }
  // the less-used pages sit under "More" (a disclosure: Escape closes it)
  const more = nav.getByRole('button', { name: 'More' });
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  for (const [name, path] of [
    ['Officer desk', '/officer'],
    ['Photo AI accuracy', '/trust'],
    ['Evidence', '/proof'],
    ['About', '/about'],
  ] as const) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
  }
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu' }).click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Farm advice you can check');
});

test('about: promises, a timeline that never blurs done and planned, the team, and no serious accessibility problems', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'Six promises we keep.' })).toBeVisible();
  // the team (v5): five portrait cards, names and roles exactly as the team gave them, each photo's alt text the name
  const team = page.getByTestId('team-cards');
  await expect(team.getByRole('heading', { level: 3 })).toHaveCount(5);
  for (const [name, role] of [['Abdullah Rubab', 'Team lead'], ['Md. Tanvir Hasan', 'UI developer'], ['Md. Sadman Al Islam Shabab', 'Full-stack developer'], ['Sourov Kumar', 'Idea generation'], ['Anushree Gope', 'Testing']]) {
    const card = team.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card).toContainText(role);
    await expect(card.getByRole('img', { name, exact: true })).toHaveAttribute('src', /\/team\/\w+-400\.webp$/);
  }
  const timeline = page.locator('ol.timeline');
  await expect(timeline.getByText('Done', { exact: true })).toHaveCount(3);
  // v6: the four planned items sit under "Planned" (a Show more fold), not in the rail
  await expect(timeline.getByText('Planned', { exact: true })).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="time-title"] details li')).toHaveCount(4);
  await noOverflow(page);
  expect(await seriousA11y(page)).toEqual([]);
});

test('404: an unknown page says so and offers the way back', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
});
