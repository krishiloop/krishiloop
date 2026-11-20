import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Nothing hidden (owner, 20 Nov: "the ways you have hidden some features, even I have a hard time finding them"):
 *  - the top bar has "Krishi officer" and "Phone app" (QR code, link, Open);
 *  - /krishi-officer is a page of its own (search, my location, district, map, the officer, Call 16123);
 *  - the home page lists every feature in "Everything you can do";
 *  - both apps carry a "Krishi officer" button in their header.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function axe(page: Page, label: string) {
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]));
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(bad, `${label}: no serious or critical axe violations`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/gibs.earthdata.nasa.gov/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
});

test('the top bar: Krishi officer opens its page; Phone app shows the QR code and the link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?lang=en');
  const nav = page.getByRole('navigation', { name: /main/i }).first();
  await nav.getByRole('link', { name: 'Krishi officer' }).click();
  await expect(page).toHaveURL(/\/krishi-officer$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your Krishi officer');
  await expect(page.getByTestId('near-page-16123')).toHaveAttribute('href', 'tel:16123');
  await expect(page.getByTestId('near-search')).toBeVisible();

  await page.getByTestId('nav-phone').click();
  const panel = page.getByTestId('nav-phone-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('open-on-phone').locator('input')).toHaveValue(/\/m$/);
  await expect(panel.getByTestId('nav-phone-open')).toHaveAttribute('href', '/m');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('on a phone the menu starts with Phone app and Krishi officer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lang=en');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-phone')).toHaveAttribute('href', '/m');
  await expect(page.getByTestId('menu-officer')).toHaveAttribute('href', '/krishi-officer');
});

test('the home page lists every feature, each one tap away', async ({ page }) => {
  await page.goto('/?lang=en');
  const qt = page.getByTestId('quick-tools');
  await qt.scrollIntoViewIfNeeded();
  await expect(qt.getByRole('link')).toHaveCount(10);
  await expect(page.getByTestId('qt-officer')).toHaveAttribute('href', '/krishi-officer');
  await expect(page.getByTestId('qt-phone')).toHaveAttribute('href', '/m');
  await expect(page.getByTestId('qt-photo')).toHaveAttribute('href', '/app?tab=photo');
});

test('both apps carry a Krishi officer button that opens the finder', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?sample=1&lang=en');
  await page.getByTestId('officer-btn').filter({ visible: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Nearest Krishi officer' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/m?sample=1&lang=en&welcome=0');
  await expect(page.getByTestId('m-head').getByTestId('officer-btn')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: /krishi-officer and the home directory, ${theme} theme`, async ({ page }) => {
    await page.goto(`/krishi-officer?lang=en&theme=${theme}`);
    await expect(page.getByTestId('officer-finder-page')).toBeVisible();
    await axe(page, `/krishi-officer ${theme}`);
    await page.goto(`/?lang=en&theme=${theme}`);
    await page.getByTestId('quick-tools').scrollIntoViewIfNeeded();
    await axe(page, `home directory ${theme}`);
  });
}

test('never a white screen: a page whose code fails to load shows Reload (after one quiet retry)', async ({ page }) => {
  await page.goto('/?lang=en');
  // the officer desk's code is "gone" (as after a deploy, for an old open tab)
  await page.route(/\/src\/features\/officer\/OfficerPage\.tsx/, (r) => r.abort());
  await page.route(/\/assets\/OfficerPage-[\w-]+\.js/, (r) => r.abort());
  await page.goto('/officer?lang=en');
  await expect(page.getByTestId('page-guard')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible();
});

test('the hero lists every language, and one tap switches (Spanish is a labelled preview)', async ({ page }) => {
  await page.goto('/?lang=en');
  const row = page.getByRole('group', { name: 'Languages' });
  await expect(row.getByRole('button')).toHaveCount(5);
  await expect(page.locator('.kg-promise')).toContainText('in their own language');
  await page.getByTestId('hero-lang-es').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByTestId('hero-lang-es')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'App del agricultor' })).toBeVisible();
  await expect(page.getByTestId('hero-lang-es')).toContainText('preview');
});
