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
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
};

test('home: the headline, the loop, the receipt tiles, and no API calls', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) api.push(u.pathname);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('with a receipt');
  await expect(page.getByRole('img', { name: /The loop: see, decide, speak, prove, learn/ })).toBeVisible();
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('রসিদ');
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
    ['Officer', '/officer'],
    ['Verify', '/verify'],
    ['Trust', '/trust'],
    ['Proof', '/proof'],
    ['About', '/about'],
  ] as const) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu' }).click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('proof behind it');
});

test('about: principles, a timeline that never blurs done and planned, and no serious accessibility problems', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'Six rules we do not bend.' })).toBeVisible();
  const timeline = page.locator('ol.timeline');
  await expect(timeline.getByText('Done', { exact: true })).toHaveCount(3);
  await expect(timeline.getByText('Planned', { exact: true })).toHaveCount(4);
  await noOverflow(page);
  expect(await seriousA11y(page)).toEqual([]);
});

test('404: an unknown page says so and offers the way back', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
});
